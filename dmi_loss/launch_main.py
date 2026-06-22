import os
import subprocess
import time
import shutil

loss_layers = [16,18,20]#[2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
base_dir = Path(__file__).resolve().parent

def get_user_jobs():
    result = subprocess.run(['squeue', '-u', os.getenv('USER'), '-h', '-o', '%A'], 
                          capture_output=True, text=True)
    if result.returncode == 0:
        return set(result.stdout.strip().split())
    return set()

def wait_for_job_completion(timeout=7200):  
    check_interval = 300
    elapsed = 0
    
    while elapsed < timeout:
        current_jobs = get_user_jobs()
        if not current_jobs:
            return True
            
        print(f"等待 {len(current_jobs)} 个作业完成...")
        time.sleep(check_interval)
        elapsed += check_interval
    
    print("等待超时，强制继续下一个文件夹")
    return False

for i in loss_layers:
    folder = "{}_layers_loss".format(i)
   
    if not os.path.exists(folder):
        os.makedirs(folder)
    
    main_py_src = os.path.join(base_dir, "main.py")
    main_py_dst = os.path.join(folder, "main.py")
    if os.path.exists(main_py_src):
        shutil.copy2(main_py_src, main_py_dst)
        print(f"已将 main.py 复制到 {folder}")
    else:
        print(f"警告: 在 {base_dir} 中找不到 main.py")
    
    os.chdir(folder)
    
    launch_py_content = f"""import os
import time
import numpy as np
from pathlib import Path

folder = "bash_files"
if not os.path.isdir(folder):
    os.makedirs(folder)

variable_name = 'weight'
loss = '{i}'
for l in range({i}, {i+1}):      
    for w in np.arange(0, 9.5, 0.5):   
        weight = 10 ** w   
        loss_val = l
        filename = folder + '/loss_{{}}_weight_{{:.1e}}.sh'.format(loss_val, weight)
    
        with open(filename, 'w') as script_file:
            script_file.write('#!/bin/bash\\n#SBATCH --nodes=1\\n#SBATCH --ntasks=1\\n#SBATCH --cpus-per-task=1\\n#SBATCH --gres=gpu:1\\n')
            script_file.write('srun python main.py --loss={{}} --weight={{}}'.format(loss_val, weight))
    
        time.sleep(1) 
        os.system(f'sbatch -p gpu {{filename}} --exclude=g0039 g0021')
"""
    
    with open('launch.py', 'w') as f:
        f.write(launch_py_content)
    
    if i != loss_layers[0]: 
        wait_for_job_completion()
    
    print(f"在 {folder} 中提交作业...")
    result = subprocess.run(['python', 'launch.py'], 
                          capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"警告: {folder} 中的作业提交可能有问题")
        print(f"错误输出: {result.stderr}")
    
    os.chdir(base_dir)
