using MicroMagnetic
using NPZ
using CairoMakie
using PyCall
using DelimitedFiles
using Printf
using CUDA

for dir_name in ["m", "vtrs", "pngs", "sknumbers", "txts"]
    if !isdir(dir_name)
        mkdir(dir_name)
    end
end

to_cpu(x::Number) = x
to_cpu(x::AbstractArray) = Array(x)[1]

function save_png(data, name)
    fig = Figure(size = (800, 600))
    ax = Axis(fig[1, 1], aspect = 1, title = name)
    hm = heatmap!(ax, data, colormap = :coolwarm, colorrange = (-1, 1))
    Colorbar(fig[1, 2], hm)
    save("pngs/$name.png", fig)
end

function relax_system(nr,ku)
  mesh =  FDMesh(dx=1.06e-9, dy=1.06e-9, dz=1.06e-9, nx=nr, ny=nr, nz=110)

  function circular_Ms(i,j,k,dx,dy,dz)
    nx,ny,nz = mesh.nx, mesh.ny, mesh.nz
    x = i-nx/2-0.5
    y = j-ny/2-0.5
    r = (x^2+y^2)^0.5
    if r<=nx/2
      return 3.84e5
    end
    return 0.0
  end

  function m0_fun(i,j,k,dx,dy,dz)
    nx,ny=mesh.nx,mesh.ny
    r = ((i-nx/2-0.5)^2 + (j-ny/2-0.5)^2)^0.5
    factor = 2/1.06
    if r < 20 * factor
      return (0.1, 0, 1)
    elseif r>=20 * factor && r<50 * factor
      return (0.1,0,-1)
    elseif r>=50 * factor && r<75 * factor
      return (0.1,0,1)
    elseif r>=75 * factor && r<100 * factor
      return (0.1,0,-1)
    elseif r>=100 * factor && r<125 * factor
      return (0.1,0,1)
    elseif r>=125 * factor && r<175 * factor
      return (0.1,0,-1)
    elseif r>=175 * factor && r<200 * factor
      return (0.1,0,1)
    elseif r>=200 * factor && r<225 * factor
      return (0.1,0,-1)
    elseif r>=225 * factor && r<250 * factor
      return (0.1,0,1)
    end
    return (0,0,1)
  end

  function energy_density(mesh,k)
    nx,ny,nz = mesh.nx, mesh.ny, mesh.nz
    dx,dy,dz = mesh.dx, mesh.dy, mesh.dz
    V = pi*(nx/2*dx)^2*nz*dz
    Ed=k/V
    return Ed 
  end

  sim = Sim(mesh, driver="SD", name="sim")
  set_Ms(sim, circular_Ms)

  dmi=1
  mu0=4*pi*1e-7
  mT=0.001/mu0
  A=4.75e-12
  L=70e-9
  D=4*pi*A/L*dmi
  
  exch = add_exch(sim, A, name="exch")
  zeeman = add_zeeman(sim, (0,0,0))
  dmi = add_dmi(sim,D,name="dmi")
  anis = add_anis(sim,ku*1e2,axis=(0,0,1))
  demag = add_demag(sim)
  init_m0(sim,m0_fun)
  m = Array(sim.spin)
  npzwrite("m/m0.npy", reshape(m, 3, nr, nr, 110))
  nx,ny,nz = mesh.nx, mesh.ny, mesh.nz
  m3d = reshape(m, 3, nx, ny, nz)
  save_png(m3d[3, :, :, 1], "init-r-'$nr'1e-9")

  for Hz = 0
    update_zeeman(sim, (0,0,Hz*mT))
    relax(sim, maxsteps=10000000000, stopping_dmdt=0.1, save_m_every=1000)
    m = Array(sim.spin)
    npzwrite("m/r-'$nr'1e-9-ku-'$ku'1e2-H-'$Hz'.npy", reshape(m, (3, nr, nr, 110)))
    nx,ny,nz = mesh.nx, mesh.ny, mesh.nz
    m3d = reshape(m, 3, nx, ny, nz)
    save_png(m3d[3, :, :, 1], "r-'$nr'1e-9-ku-'$ku'1e2-H-'$Hz'")
    mx,my,mz = MicroMagnetic.average_m(sim)
    mx = to_cpu(mx)
    my = to_cpu(my) 
    mz = to_cpu(mz)
    p = compute_skyrmion_number(m, mesh)

    MicroMagnetic.effective_field(sim, sim.spin, 0.0)
    t = to_cpu(sim.energy)
    e = to_cpu(exch.energy)
    z = to_cpu(zeeman.energy)
    d = to_cpu(dmi.energy)
    a = to_cpu(anis.energy)
    dm = to_cpu(demag.energy)
    et = energy_density(mesh,t)
    ee = energy_density(mesh,e)
    ez = energy_density(mesh,z)
    ed = energy_density(mesh,d)
    ea = energy_density(mesh,a)
    edm = energy_density(mesh,dm)
    data_list = [et, ee, ez, ed, ea, edm, mx, my, mz]

    writedlm("txts/r-'$nr'1e-9-ku-'$ku'1e2-H-'$Hz'.txt", Array(data_list))
    writedlm("sknumbers/r-'$nr'1e-9-ku-'$ku'1e2-H-'$Hz'.txt", [nr, ku, p])

    MicroMagnetic.save_vtk_points(sim, "vtrs/r-'$nr'1e-9-ku-'$ku'1e2-H-'$Hz'")
  end
end

for nr=136, ku=(0:10:0)
  relax_system(nr,ku)
end
