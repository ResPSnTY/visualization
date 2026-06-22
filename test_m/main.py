import numpy as np
import matplotlib.pyplot as plt
import maglab
from maglab.saver import Saver
import os
import argparse
import torch
import torch.nn.functional as F
import glob
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = next((p for p in SCRIPT_DIR.parents if (p / "dataset").exists()), SCRIPT_DIR)
DATASET_DIR = REPO_ROOT / "dataset"

torch.set_default_dtype(torch.float32)
parser = argparse.ArgumentParser()
parser.add_argument('--weight', type=float, default=1e0)
parser.add_argument('--loss', type=float, default=0)
#parser.add_argument('--dia', type=int, default=134)
#parser.add_argument('--height', type=int, default=96)
args = parser.parse_args()
weight_phi = 10**7.0
weight_m = args.weight
loss = args.loss
#d = args.dia
#h = args.height

output_dir = SCRIPT_DIR / 'results' / 'loss{:.1e}_wm{:.1e}'.format(loss, weight_m)
if not os.path.isdir(output_dir):
    os.makedirs(output_dir)

N = 206
dx = 1.06e-9
geo = maglab.geo.cylider(136, 111)#(140 , 96)
nx, ny, nz = geo.shape
Ms = 3.84e5
A = 4.75e-12 # lv para
D = 8.53e-4  # lv para         
#A = 8.78e-12  # zheng para
#D = 4 * np.pi * A / 70e-9 # zheng para
print("feature length: ", 4*np.pi*A/D*1e9, "nm")

if weight_m == 1e0:
    m0 = (0,0,-1)
else:
    base_pattern = str(SCRIPT_DIR / "results" / "loss{:.1e}_wm{:.1e}".format(loss, weight_m))
    if weight_m < 1e0:
        target_weight = weight_m * 10
        search_pattern = base_pattern.replace("wphi{:.1e}".format(weight_phi), "wphi{:.1e}".format(weight_phi)) + "_wm{:.1e}".format(target_weight)
    else:
        target_weight = weight_m / 10
        search_pattern = base_pattern.replace("wphi{:.1e}".format(weight_phi), "wphi{:.1e}".format(weight_phi)) + "_wm{:.1e}".format(target_weight)

    matching_folders = glob.glob(search_pattern + "*")
    if matching_folders:
        target_folder = matching_folders[0]
        state_file = os.path.join(target_folder, "final.pth")
        
        if os.path.exists(state_file):
            print(f"从{state_file}读取初始状态")
            state = maglab.Micro.load_state(state_file)
            m0 = state.spin
        else:
            print(f"警告: 在 {target_folder} 中未找到 final.pth，使用默认初始状态")
            m0 = (0,0,-1)
    else:
        print(f"警告: 未找到匹配的文件夹 {search_pattern}，使用默认初始状态")
        m0 = (0,0,-1)

radius = 68           
height = 111 
s = loss
x = np.arange(nx) - nx//2  
y = np.arange(ny) - ny//2  
z = np.arange(nz)        
xx, yy, zz = np.meshgrid(x, y, z, indexing='ij') 
r = np.sqrt(xx**2 + yy**2)
bulk_mask = np.zeros_like(r, dtype=bool)
radial_condition = (r < radius - s)  
z_condition = (zz > s-1) & (zz < height - s)  
bulk_mask = z_condition #radial_condition & z_condition  
D_bulk = np.zeros_like(r, dtype=np.float32)
D_bulk[bulk_mask] = D
D_bulk = np.stack([D_bulk, D_bulk, D_bulk], axis=0) 

alphas = [0, 28, 44, 50, 54, 58, 61, 65]
phasemapper = maglab.PhaseMapper(N, dx, rotation_padding=N).cuda()
phaseset = maglab.dataset.PhaseSet()
for alpha in alphas:
    phasemap = torch.load(DATASET_DIR / "dm3_refin" / "refin_3dmask_pm" / f"phasemap_{alpha}.pth")
    for item in phasemap:
        data  = item['data'].transpose((1,0))
        mask  = item['mask'].transpose((1,0))
        alpha = -item['alpha']
        phasemap = maglab.dataset.PhaseMap(data=data, mask=mask, alpha=alpha)
    phaseset.load(phasemap)
phaseset.sort()

micro = maglab.Micro(nx, ny, nz, dx)
micro.init_m0(m0)
micro.set_Ms(Ms*geo)
micro.add_exch(A)
micro.add_dmi(D_bulk)
micro.add_demag()
micro.cuda()
sd = maglab.SteepestDescent(micro.shape).cuda()

# Remove low-f background, and apply mask on the phasemap
def remove_background(phase, mask, ):
    # we need to compare the phase shift after removal of low-frequency signal, so we apply a gauss kernel filter on the images.
    gauss_kernel_size = 99
    sigma = maglab.preprocess.compute_sigma(gauss_kernel_size)
    kernel = maglab.preprocess.gaussian_kernel(gauss_kernel_size, sigma)
    kernel_groups = kernel.repeat(8, 1, 1, 1).cuda()
    phase_blurred = F.conv2d(phase, kernel_groups, groups=8, padding=gauss_kernel_size // 2)
    return (mask * (phase - phase_blurred))

def delta_phi(phi1, phi2):
    phi1 = phi1.detach().cpu().numpy()
    phi2 = phi2.detach().cpu().numpy()
    delta = np.mean(abs(phi1 - phi2)) / np.mean(abs(phi1))
    return delta

mask = torch.stack([phasemap.mask for phasemap in phaseset]).cuda()
alphas = [x.Euler[0] for x in phaseset]
betas = [x.Euler[1] for x in phaseset]
num_phase = len(phaseset)
w1, w2 = weight_m, weight_phi
history = []
saver = Saver(f"{output_dir}/log.txt")

phase_exeperiments = torch.stack([x.data for x in phaseset]).cuda()

file_path = DATASET_DIR / "phase_calc"
state = micro.load_state(str(file_path / "w0_calc.pth"))
m_init = state.spin.detach().cpu().numpy()
phase_calculated = torch.stack([phasemapper(m_init, 
                                          alpha=alphas[i], 
                                          beta=betas[i], 
                                          Ms=Ms) 
                              for i in range(num_phase)])

def step_forward():
    spin = micro.get_spin()
    micromagnetic_field = micro.get_total_field(spin)
    phase_pred = torch.stack([phasemapper(spin, 
                                          alpha=alphas[i], 
                                          beta=betas[i], 
                                          Ms=Ms) 
                              for i in range(num_phase)])
    phase_diff = remove_background((phase_pred-phase_calculated), mask)

    phi_loss = 0.
    for i in range(8):
        if i ==6 or i ==7:
            # apply 3x weight on low-tilt-angle phase
            phi_loss += 3 * w2 * torch.sum(phase_diff[i,]**2)
        else:
            phi_loss += w2 * torch.sum(phase_diff[i,]**2)
    phase_field = micro.get_field_from_loss(phi_loss, spin)
    total_field = w1 * micromagnetic_field + phase_field
    new_spin = sd(spin, total_field)
    micro.update_spin(new_spin)
    return phase_pred

for epoch in range(6001):
    phase_pred = step_forward()
    delta = delta_phi(remove_background(phase_calculated, mask), remove_background(phase_pred, mask))
    info = [epoch, delta.item()]
    history.append(info)
    content = 'info:{}'.format(info,)
    saver.write(content)
    print(content)

    if epoch % 100 == 0:
        spin = micro.get_spin().detach().cpu().numpy()
        maglab.display.show_list([spin[i, :, :, nz//2] for i in range(3)], 
                                titles=["mx", "my", "mz"])
        plt.savefig(f"{output_dir}/epoch{epoch}_xy.jpg")
        plt.close()
        maglab.display.show_list([spin[i, :, ny//2, :] for i in range(3)], 
                                titles=["mx", "my", "mz"])
        plt.savefig(f"{output_dir}/epoch{epoch}_xz.jpg")
        plt.close()
        
spin = micro.get_spin().detach().cpu().numpy()
np.save(f"{output_dir}/spin.npy", spin) 
np.save(f"{output_dir}/history.npy", np.array(history))        
micro.save_state(f"{output_dir}/final.pth")
maglab.vtk.write_vtk(f"{output_dir}/final.vtk", spin, data_name="m", dx=dx)
