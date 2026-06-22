# Data path notes

The plotting notebooks were updated to avoid machine-specific paths. References to the reconstruction outputs now point to `../recon-scripts/...`, matching the directory names used on the `recon-scripts` branch (`test_phi`, `test_m`, `dmi_loss`, `separate`, `robustness`, `target_mm`, and `dataset`).

For a local checkout, place a checkout/export of the `recon-scripts` branch next to this `data-plots` checkout, or adjust the relative paths in the notebooks to your local location.
