import os
import time
import shutil
import subprocess
from pathlib import Path

import numpy as np
import hyperspy.api as hs
import pyvista as pv
from PIL import Image
import imageio_ffmpeg


# ============================================================
# 1. 基本参数
# ============================================================

file_path = "./3dmask.dm3"   # 如果 3dmask.dm3 和 plot.py 在同一目录，用这个
# file_path = "/mnt/data/3dmask.dm3"

threshold = 0.5

# "voxel"   ：最接近原始三维二值 mask 的体素边界
# "contour" ：等值面显示，更连续，但不是严格体素块
render_mode = "voxel"

movie_name = "manual_3dmask_recording.mp4"

# 录制帧率。为了流畅，建议 5~10
fps = 8

frame_dir = Path("frames_manual_recording")

# 是否显示中心原点小球
show_origin_sphere = True

# 是否显示坐标轴、边框、网格
# 如果最终视频只想保留 mask，可以改成 False
show_axes_and_bounds = True

# 交互窗口尺寸，也是最终视频尺寸
window_size = (900, 720)


# ============================================================
# 2. 读取 3D mask 数据
# ============================================================

s = hs.load(file_path)

# 沿用你之前 notebook 中的轴顺序
data = s.data.transpose((2, 1, 0))

print("原始数据 shape:", s.data.shape)
print("转置后数据 shape:", data.shape)
print("数据最小值:", np.min(data))
print("数据最大值:", np.max(data))


# ============================================================
# 3. 二值化得到三维 mask
# ============================================================

mask = (data > threshold).astype(np.uint8)

print("mask shape:", mask.shape)
print("mask 非零体素数:", np.count_nonzero(mask))
print("mask 体素占比:", np.count_nonzero(mask) / mask.size)


# ============================================================
# 4. 体素尺寸 spacing
# ============================================================
# 你的文件当前没有成功读到 scale，所以这里先明确用像素坐标。
# 如果你后面确认每个体素是 1.06 nm，可以改成 spacing = np.array([1.06, 1.06, 1.06])

spacing = np.array([1.0, 1.0, 1.0], dtype=float)
print("使用 spacing =", spacing)

nx, ny, nz = mask.shape


# ============================================================
# 5. 构造以 mask 中心为坐标原点的 PyVista 网格
# ============================================================

if render_mode == "voxel":

    grid = pv.ImageData()

    # cell_data 需要 dimensions = cell 数量 + 1
    grid.dimensions = (nx + 1, ny + 1, nz + 1)
    grid.spacing = tuple(spacing)

    # 把 mask 几何中心放在坐标原点
    grid.origin = tuple(-0.5 * np.array([nx, ny, nz]) * spacing)

    # 一个 mask 体素对应一个 cell
    grid.cell_data["mask"] = mask.flatten(order="F")

    selected = grid.threshold(
        value=0.5,
        scalars="mask"
    )

    surface = selected.extract_surface().clean()

elif render_mode == "contour":

    grid = pv.ImageData()
    grid.dimensions = (nx, ny, nz)
    grid.spacing = tuple(spacing)

    grid.origin = tuple(-0.5 * (np.array([nx, ny, nz]) - 1) * spacing)

    grid.point_data["mask"] = mask.astype(np.float32).flatten(order="F")

    surface = grid.contour(
        isosurfaces=[0.5],
        scalars="mask"
    )

else:
    raise ValueError("render_mode 只能是 'voxel' 或 'contour'")


print("表面点数:", surface.n_points)
print("表面单元数:", surface.n_cells)
print("surface bounds:", surface.bounds)


# ============================================================
# 6. 字体和颜色设置
# ============================================================

pv.global_theme.font.family = "arial"
pv.global_theme.font.size = 8
pv.global_theme.font.label_size = 8
pv.global_theme.font.title_size = 8

mask_color = "#8FAFC3"      # 灰蓝色
axis_color = "#333333"      # 深灰色
origin_color = "#8B1A1A"    # 深红色


# ============================================================
# 7. 场景添加函数
# ============================================================

def add_scene_to_plotter(plotter_obj, include_axes=True, include_origin=True):
    """
    给 plotter 添加三维 mask、坐标轴和原点。
    注意：这里不添加任何录制按钮或说明文字。
    最终视频使用这个干净场景重新渲染。
    """

    plotter_obj.set_background("white")

    plotter_obj.add_mesh(
        surface,
        color=mask_color,
        opacity=1.0,
        show_edges=False,
        smooth_shading=False
    )

    if include_axes:

        # 新版本 PyVista 推荐 xtitle/ytitle/ztitle
        plotter_obj.show_bounds(
            grid="back",
            location="outer",
            all_edges=True,
            color=axis_color,
            font_size=8,
            font_family="arial",
            xtitle="X",
            ytitle="Y",
            ztitle="Z"
        )

        plotter_obj.add_axes(
            xlabel="X",
            ylabel="Y",
            zlabel="Z",
            color=axis_color,
            x_color=axis_color,
            y_color=axis_color,
            z_color=axis_color,
            line_width=1,
            labels_off=False
        )

    if include_origin:

        origin_sphere = pv.Sphere(
            radius=2.0 * np.mean(spacing),
            center=(0.0, 0.0, 0.0)
        )

        plotter_obj.add_mesh(
            origin_sphere,
            color=origin_color,
            opacity=1.0,
            smooth_shading=False
        )


def set_initial_camera(plotter_obj):
    """
    设置初始相机视角。
    """

    bounds = surface.bounds

    x_len = bounds[1] - bounds[0]
    y_len = bounds[3] - bounds[2]
    z_len = bounds[5] - bounds[4]

    max_len = max(x_len, y_len, z_len)
    camera_distance = 2.6 * max_len

    # 初始约 45° 俯角观察
    plotter_obj.camera_position = [
        (camera_distance, -camera_distance, camera_distance),
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 1.0)
    ]

    plotter_obj.camera.zoom(1.1)


# ============================================================
# 8. 创建交互窗口
# ============================================================

plotter = pv.Plotter(
    window_size=window_size,
    off_screen=False
)

add_scene_to_plotter(
    plotter,
    include_axes=show_axes_and_bounds,
    include_origin=show_origin_sphere
)

set_initial_camera(plotter)


# ============================================================
# 9. 录制状态变量：只记录相机轨迹，不实时截图
# ============================================================

record_state = {
    "recording": False,
    "camera_positions": [],
    "movie_path": Path(movie_name).resolve(),
    "last_record_time": 0.0,
    "min_interval": 1.0 / fps,
    "status_text": None
}


# ============================================================
# 10. 记录当前相机位置
# ============================================================

def record_camera_position(force=False):
    """
    只保存相机位置，不截图。
    这样交互时不会明显卡顿。
    """

    if not record_state["recording"]:
        return

    now = time.time()

    if (not force) and (now - record_state["last_record_time"] < record_state["min_interval"]):
        return

    cam_pos = plotter.camera_position

    cam_pos_copy = (
        tuple(cam_pos[0]),
        tuple(cam_pos[1]),
        tuple(cam_pos[2])
    )

    record_state["camera_positions"].append(cam_pos_copy)
    record_state["last_record_time"] = now

    n = len(record_state["camera_positions"])

    if n % 20 == 0:
        print(f"已记录 {n} 个相机关键帧")


# ============================================================
# 11. 交互事件回调：拖动时记录相机位置
# ============================================================

def interaction_callback(obj=None, event=None):
    """
    使用 PyVista 默认交互方式。
    旋转、缩放、平移时，只记录相机位置。
    """

    if record_state["recording"]:
        record_camera_position(force=False)


# ============================================================
# 12. 离线渲染视频
# ============================================================

def render_video_from_camera_path():
    """
    根据记录的相机轨迹，用干净窗口离线渲染视频。
    最终视频里不会出现录制按钮、REC文字或说明文字。
    """

    camera_positions = record_state["camera_positions"]
    movie_path = record_state["movie_path"]

    n_frames_recorded = len(camera_positions)

    if n_frames_recorded == 0:
        print("没有记录到相机关键帧，不生成视频。")
        return

    if n_frames_recorded == 1:
        camera_positions = camera_positions * 2
        n_frames_recorded = 2

    print(f"开始离线渲染视频，共 {n_frames_recorded} 帧...")

    if frame_dir.exists():
        shutil.rmtree(frame_dir)
    frame_dir.mkdir(parents=True, exist_ok=True)

    clean_plotter = pv.Plotter(
        window_size=window_size,
        off_screen=True
    )

    # 干净场景，不包含按钮和文字
    add_scene_to_plotter(
        clean_plotter,
        include_axes=show_axes_and_bounds,
        include_origin=show_origin_sphere
    )

    clean_plotter.show(auto_close=False)

    for i, cam_pos in enumerate(camera_positions):

        clean_plotter.camera_position = cam_pos
        clean_plotter.render()

        img = clean_plotter.screenshot(return_img=True)
        img = np.asarray(img)

        if img.dtype != np.uint8:
            img = np.clip(img, 0, 255).astype(np.uint8)

        if img.ndim == 3 and img.shape[2] == 4:
            img = img[:, :, :3]

        frame_path = frame_dir / f"frame_{i:05d}.png"
        Image.fromarray(img).save(frame_path)

        if (i + 1) % 30 == 0:
            print(f"已渲染 {i + 1}/{n_frames_recorded} 帧")

    clean_plotter.close()

    print("PNG 帧渲染完成，开始合成 MP4...")

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

    cmd = [
        ffmpeg_exe,
        "-y",
        "-framerate", str(fps),
        "-i", str(frame_dir / "frame_%05d.png"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "18",
        str(movie_path)
    ]

    subprocess.run(cmd, check=True)

    print("视频保存完成:")
    print(movie_path)

    shutil.rmtree(frame_dir)
    print("临时帧文件夹已删除。")


# ============================================================
# 13. 开始 / 停止录制
# ============================================================

def start_recording():
    """
    开始记录相机轨迹。
    """

    if record_state["recording"]:
        print("已经在记录中。")
        return

    print("开始记录相机轨迹。再次点击顶部 REC 按钮停止并生成视频。")

    record_state["recording"] = True
    record_state["camera_positions"] = []
    record_state["last_record_time"] = 0.0

    # 交互窗口里可以显示状态提示，但最终视频不会包含它
    if record_state["status_text"] is not None:
        plotter.remove_actor(record_state["status_text"])

    record_state["status_text"] = plotter.add_text(
        "Recording...",
        position=(70, window_size[1] - 42),
        font_size=8,
        color="red",
        font="arial"
    )

    # 开始时记录第一帧
    record_camera_position(force=True)


def stop_recording():
    """
    停止记录，并生成视频。
    """

    if not record_state["recording"]:
        print("当前没有在记录。")
        return

    print("停止记录相机轨迹，开始生成视频。")

    # 停止前记录最后一帧
    record_camera_position(force=True)

    record_state["recording"] = False

    if record_state["status_text"] is not None:
        plotter.remove_actor(record_state["status_text"])
        record_state["status_text"] = None

    render_video_from_camera_path()


# ============================================================
# 14. 顶部录制按钮
# ============================================================

def record_button_callback(value):
    """
    value=True  : 开始录制
    value=False : 停止录制并生成视频
    """

    if value:
        start_recording()
    else:
        stop_recording()


# PyVista 的 position 坐标原点在左下角。
# y = window_size[1] - 55 表示靠近顶部。
plotter.add_checkbox_button_widget(
    callback=record_button_callback,
    value=False,
    position=(20, window_size[1] - 55),
    size=34,
    border_size=2,
    color_on="red",
    color_off="lightgray",
    background_color="white"
)

plotter.add_text(
    "REC",
    position=(60, window_size[1] - 47),
    font_size=8,
    color=axis_color,
    font="arial"
)


# ============================================================
# 15. 绑定交互事件
# ============================================================

observer_bound = False

try:
    plotter.iren.add_observer("InteractionEvent", interaction_callback)
    plotter.iren.add_observer("EndInteractionEvent", interaction_callback)
    observer_bound = True
    print("已绑定 PyVista iren interaction observer。")

except Exception:

    try:
        plotter.iren.interactor.AddObserver("InteractionEvent", interaction_callback)
        plotter.iren.interactor.AddObserver("EndInteractionEvent", interaction_callback)
        observer_bound = True
        print("已绑定 VTK interactor interaction observer。")

    except Exception as e:
        print("交互事件绑定失败：")
        print(e)


if not observer_bound:
    print("警告：交互事件没有成功绑定。")
    print("这种情况下可能只能记录开始和停止两个相机位置。")


# ============================================================
# 16. 打开交互窗口
# ============================================================

print("使用方法：")
print("1. 点击顶部 REC 按钮开始录制")
print("2. 用鼠标旋转、缩放、平移")
print("3. 再次点击顶部 REC 按钮停止并生成视频")
print("最终视频不会包含 REC 按钮和 Recording 文字。")

plotter.show()

print("交互窗口已关闭。")