# TargetSkyrmion VTR Visualization

Live demo:

https://respsnty.github.io/visualization/

![VTR viewer demo](docs/viewer-demo.png)

> **Three-dimensional magnetization by holographic vector field electron tomography**
>
> Yi Zhao,<sup>1,2</sup> Weiwei Wang,<sup>3,*</sup> Boyao Lyu,<sup>1</sup> Jan Caron,<sup>4</sup> Shasha Wang,<sup>1</sup> Dongsheng Song,<sup>3</sup> Hongchu Du,<sup>4</sup> Rafal E. Dunin-Borkowski,<sup>4</sup> Haifeng Du,<sup>1,&dagger;</sup> and Fengshan Zheng<sup>5,6,&Dagger;</sup>
>
> <sup>1</sup>Anhui Province Key Laboratory of Low-Energy Quantum Materials and Devices, High Magnetic Field Laboratory, HFIPS, Chinese Academy of Sciences, Hefei, Anhui 230031, China  
> <sup>2</sup>University of Science and Technology of China, Hefei 230026, China  
> <sup>3</sup>Institutes of Physical Science and Information Technology, Anhui University, Hefei 230601, China  
> <sup>4</sup>Ernst Ruska-Centre for Microscopy and Spectroscopy with Electrons and Peter Grunberg Institute, Forschungszentrum Julich, Julich 52425, Germany  
> <sup>5</sup>Spin-X Institute, School of Physics and Optoelectronics, Guangdong-Hong Kong-Macao Joint Laboratory of Optoelectronic and Magnetic Functional Materials, State Key Laboratory of Luminescent Materials and Devices, South China University of Technology, Guangzhou 511442, China  
> <sup>6</sup>Center for Electron Microscopy, South China University of Technology, Guangzhou 511442, China  
>
> Dated: June 17, 2026

### Display

- `Show Grid`: Show or hide the reference grid.
- `Mesh`: Switch the bounding box display mode between `outline`, `box`, and `hidden`.

### Arrows

- `Mode`
  - `all`: Sample arrows throughout the full 3D volume.
  - `layer`: Show arrows only on one selected slice layer.
- `Direction`: Select the layer direction in `layer` mode. Supported directions are `x`, `y`, and `z`.
- `Index`: Select the layer index in `layer` mode. The range is updated automatically from the data dimensions.
- `Nx / Ny / Nz`: Control the arrow sampling density.
- `Size`: Control the arrow size.
- `Component`: Color arrows by the `mx`, `my`, or `mz` component.
- `Colormap`: Select the arrow colormap.

### Slice

- `Direction`: Select the slice direction.
- `Index`: Select the slice layer index.
- `Component`
  - `all-components`: Use HSV color for the in-plane magnetization direction, with black/white shading from `mz`.
  - `mx / my / mz`: Show a single magnetization component.
- `Colormap`: Select the slice colormap.

### Isosurface

- `Show`: Enable or disable the isosurface.
- `Component`: Generate the isosurface from `mx`, `my`, or `mz`.
- `Value`: Set the isosurface value.
- `Resolution`: Set the Marching Cubes resolution. Higher values produce finer surfaces but take longer to compute.

## Local Preview

To preview locally, run this command in the project directory:

```powershell
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

Do not open `index.html` by double-clicking it directly. Most browsers block local pages from reading `final.vtr`.
