import importlib.util
import os
import sys
from pathlib import Path

PREFERRED_PYTHON = Path.home() / "anaconda3" / "envs" / "maglab" / "bin" / "python"
REQUIRED_MODULES = ("hyperspy", "matplotlib", "numpy", "scipy")


def relaunch_with_preferred_python(reason):
    current_python = Path(sys.executable).resolve()
    if not PREFERRED_PYTHON.exists():
        return

    preferred_python = PREFERRED_PYTHON.resolve()
    if current_python == preferred_python:
        return

    if os.environ.get("MASK_PROJ_NO_AUTO_REEXEC") == "1":
        return

    print(reason, flush=True)
    print(f"Current Python: {current_python}", flush=True)
    print(f"Relaunching with: {preferred_python}", flush=True)
    os.execv(str(preferred_python), [str(preferred_python), *sys.argv])


missing_modules = [
    module_name
    for module_name in REQUIRED_MODULES
    if importlib.util.find_spec(module_name) is None
]

if missing_modules:
    relaunch_with_preferred_python(
        "The current Python environment is missing required modules: "
        + ", ".join(missing_modules)
    )

if missing_modules:
    raise ModuleNotFoundError(
        "Missing required modules: "
        + ", ".join(missing_modules)
        + ". Use: conda activate maglab && python generate_mask_projections.py <target_dir>"
    )

import hyperspy.api as hs
import matplotlib.pyplot as plt
import numpy as np
from scipy.ndimage import binary_dilation, rotate, shift


THRESHOLD = 0.5
DILATION_ITER = 1

# Same angles and projection method as main.ipynb.
ANGLE_LABELS = [0, 28, 44, 50, 54, 58, 61, 65]
ROTATION_ANGLES = [0, 28, 44, 50, 54, 58, 61, 65.2]

# Same manual alignment shifts as main.ipynb cell 6.
# l > 0 down, l < 0 up; h > 0 right, h < 0 left.
SHIFTS = {
    0: (2, -2),
    28: (-1, 0),
    44: (-1, 0),
    50: (4, 1),
    54: (2, 0),
    58: (4, 0),
    61: (3, 1),
    65: (5, 0),
}


def process_and_project_mask(file_path, threshold, rotation_angle, dilation_iter):
    signal = hs.load(file_path)
    data = signal.data.transpose((2, 1, 0))
    mask = data > threshold
    mask_int = mask.astype(np.int8)

    rotated_mask = rotate(
        mask_int,
        angle=-1 * rotation_angle,
        axes=(1, 2),
        reshape=False,
        order=0,
        mode="constant",
        cval=0,
    )

    projection = np.max(rotated_mask, axis=2)
    projection = np.rot90(projection, k=1)

    if dilation_iter > 0:
        projection = binary_dilation(projection, iterations=dilation_iter)

    return projection.astype(np.float32)


def save_projection_image(projection, output_path):
    plt.imsave(output_path, projection, cmap="gray", vmin=0, vmax=1)


def save_projection_panel(projections, output_dir):
    fig, axes = plt.subplots(2, 4, figsize=(12, 6))
    for ax, angle, projection in zip(axes.ravel(), ANGLE_LABELS, projections):
        ax.imshow(projection, cmap="gray", vmin=0, vmax=1)
        ax.set_title(f"{angle} deg")
        ax.axis("off")

    fig.tight_layout(pad=0.5)
    fig.savefig(output_dir / "mask_projection_panel.png", dpi=300)
    plt.close(fig)


def main():
    target_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    input_path = target_dir / "3dmask.dm3"
    output_dir = target_dir / "mask_projection_images"

    if not input_path.exists():
        raise FileNotFoundError(input_path.resolve())

    output_dir.mkdir(parents=True, exist_ok=True)

    projections = []
    for angle_label, rotation_angle in zip(ANGLE_LABELS, ROTATION_ANGLES):
        projection = process_and_project_mask(
            input_path,
            threshold=THRESHOLD,
            rotation_angle=rotation_angle,
            dilation_iter=DILATION_ITER,
        )

        l_shift, h_shift = SHIFTS[angle_label]
        projection = shift(
            projection,
            shift=[l_shift, h_shift],
            order=0,
            mode="constant",
            cval=0,
        )
        projection = (projection > 0.5).astype(np.float32)
        projections.append(projection)

        output_path = output_dir / f"mask_projection_{angle_label:02d}deg.png"
        save_projection_image(projection, output_path)
        print(f"Saved {output_path}")

    save_projection_panel(projections, output_dir)
    print(f"Saved {output_dir / 'mask_projection_panel.png'}")


if __name__ == "__main__":
    main()
