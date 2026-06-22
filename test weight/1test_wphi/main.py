import numpy as np
import matplotlib.pyplot as plt
import maglab
import torch
import torch.nn.functional as F

def remove_background(phase, mask, ):
    # we need to compare the phase shift after removal of low-frequency signal, so we apply a gauss kernel filter on the images.
    gauss_kernel_size = 99
    sigma = maglab.preprocess.compute_sigma(gauss_kernel_size)
    kernel = maglab.preprocess.gaussian_kernel(gauss_kernel_size, sigma)
    kernel_groups = kernel.repeat(8, 1, 1, 1).cuda()
    phase_blurred = F.conv2d(phase, kernel_groups, groups=8, padding=gauss_kernel_size // 2)
    return (mask * (phase - phase_blurred))

N = 206
dx = 1.06e-9
geo = maglab.geo.cylider(136, 111)
nx, ny, nz = geo.shape
Ms = 3.84e5
micro = maglab.Micro(nx, ny, nz, dx)

alphas = [0, 28, 44, 50, 54, 58, 61, 65]
phasemapper = maglab.PhaseMapper(N, dx, rotation_padding=N).cuda()
phaseset = maglab.dataset.PhaseSet()
for alpha in alphas:
    phasemap = torch.load(f"D:\\Projects\\TargetSkyrmion\\targetdata\\dataset\\dm3_refin\\refin_3dmask_pm\\phasemap_{alpha}.pth", weights_only=False)
    for item in phasemap:
        data  = item['data'].transpose((1,0))
        mask  = item['mask'].transpose((1,0))
        alpha = -item['alpha']
        phasemap = maglab.dataset.PhaseMap(data=data, mask=mask, alpha=alpha)
    phaseset.load(phasemap)
phaseset.sort()

phase_exeperiments = torch.stack([x.data for x in phaseset]).cuda()
mask = torch.stack([phasemap.mask for phasemap in phaseset]).cuda()
alphas = [x.Euler[0] for x in phaseset]
betas = [x.Euler[1] for x in phaseset]
num_phase = len(phaseset)

base_path = 'D:\\Projects\\TargetSkyrmion\\targetdata\\1_test_wphi\\results\\loss0.0e+00_wphi{w:.1e}'
ws = [10**0, 10**0.5, 10**1, 10**1.5, 10**2, 10**2.5, 10**3, 10**3.5, 10**4, 10**4.5, 10**5, 10**5.5, 10**6, 10**6.5, 10**7, 10**7.5, 10**8, 10**8.5, 10**9]
energy_values = []
phi_loss_values = []
tot_losses = []

for w in ws:
    file_path = base_path.format(w=w)
    w1, w2 = 1, w
    try:
        state = micro.load_state(f"{file_path}\\final.pth")
        spin = state.get_spin().cuda()

        energy_density = state.get_energy_density(spin)
        tot_energy = torch.sum(energy_density)# * state.dx**3
        energy_value = tot_energy.item()

        phase_pred = torch.stack([phasemapper(spin, 
                                                alpha=alphas[i], 
                                                beta=betas[i], 
                                                Ms=Ms) 
                                    for i in range(num_phase)])

        phase_diff = remove_background((phase_pred-phase_exeperiments), mask)

        phi_loss = 0.
        for i in range(8):
            if i == 6 or i == 7:
                phi_loss += 3 * torch.sum(phase_diff[i,]**2)
            else:
                phi_loss += torch.sum(phase_diff[i,]**2)
                
        phi_loss_value = phi_loss.item()
        print(f"log10(w_phi)={np.log10(w)}, energy={energy_value}, phi_loss={phi_loss_value}")
        
        energy_values.append(energy_value)
        phi_loss_values.append(phi_loss_value)
        tot_losses.append(energy_value/(w) + phi_loss_value)

    except Exception as e:
        print(f"Error processing w={w}: {e}")

energy_values = np.array(energy_values)
phi_loss_values = np.array(phi_loss_values)
tot_loss_values = np.array(tot_losses)
Lm = energy_values#(energy_values - np.min(energy_values)) / (np.max(energy_values) - np.min(energy_values))
Lphi = phi_loss_values#(phi_loss_values - np.min(phi_loss_values)) / (np.max(phi_loss_values) - np.min(phi_loss_values))
Ltotal = tot_loss_values#(phi_loss_values - np.min(phi_loss_values)) / (np.max(phi_loss_values) - np.min(phi_loss_values)) + (energy_values - np.min(energy_values)) / (np.max(energy_values) - np.min(energy_values))

with open('loss.txt', 'w') as f:
    f.write("n, Lm, Lphi, Ltotal\n")
    for i, w in enumerate(ws):
        f.write(f"{np.log10(w)}, {Lm[i]}, {Lphi[i]}, {Ltotal[i]}\n")
print("数据已保存到 loss.txt 文件中")

plt.figure(figsize=(12, 8))

plt.subplot(2, 2, 1)
plt.plot(np.log10(ws), Lm, 'o-', linewidth=2, markersize=8)
plt.xlabel('w_phi')
plt.ylabel('Normalized Energy (Lm)')
plt.grid(True, alpha=0.3)
plt.xticks(np.log10(ws))

plt.subplot(2, 2, 2)
plt.plot(np.log10(ws), Lphi, 'o-', linewidth=2, markersize=8)
plt.xlabel('w_phi')
plt.ylabel('Normalized Phi Loss (Lphi)')
plt.grid(True, alpha=0.3)
plt.xticks(np.log10(ws))

plt.subplot(2, 2, 3)
plt.plot(np.log10(ws), Ltotal, 'o-', linewidth=2, markersize=8)
plt.xlabel('w_phi')
plt.ylabel('Normalized Total Loss (Ltotal)')
plt.grid(True, alpha=0.3)
plt.xticks(np.log10(ws))

plt.subplot(2, 2, 4)
plt.plot(np.log10(ws), Lm, 'o-', linewidth=2, markersize=8, label='Lm')
plt.plot(np.log10(ws), Lphi, 'o-', linewidth=2, markersize=8, label='Lphi')
plt.plot(np.log10(ws), Ltotal, 'o-', linewidth=2, markersize=8, label='Ltotal')
plt.xlabel('w_phi')
plt.ylabel('Normalized Values')
plt.legend()
plt.grid(True, alpha=0.3)
plt.xticks(np.log10(ws))

plt.tight_layout()
plt.show()