# Reconstruction scripts and outputs

This branch contains reconstruction/optimization scripts, their generated outputs, and the input dataset files needed by those scripts.

## Directory mapping

- `test_phi/`: from `1test_phi`, phase-loss weight test.
- `test_m/`: from `2test_m`, micromagnetic weight test.
- `dmi_loss/`: from `3dmi_loss`, DMI/layer-loss sweeps.
- `separate/`: from `4seperate`, separated energy-term tests.
- `robustness/`: from `5robust`, robustness tests.
- `target_mm/`: from `targetmm`, target micromagnetic outputs.
- `dataset/`: selected input experimental/calculated data used by the scripts.

The uploaded scripts were adjusted to locate `dataset/` relative to the downloaded repository instead of using the original machine-specific absolute path. Output folders are resolved relative to each script directory.
