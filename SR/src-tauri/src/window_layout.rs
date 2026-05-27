use tauri::{PhysicalPosition, WebviewWindow};

const EDGE_MARGIN: i32 = 12;
/// 托盘 / 任务栏区域预留高度，使窗口出现在托盘图标上方
const TRAY_CLEARANCE: i32 = 52;

/// 主设置窗：工作区右下角，托盘上方
pub fn place_main_above_tray(window: &WebviewWindow) -> Result<(), String> {
    let size = window
        .outer_size()
        .map_err(|e| format!("读取窗口尺寸失败: {e}"))?;
    let (area_x, area_y, area_w, area_h) = monitor_work_area_near_cursor()?;
    let w = size.width as i32;
    let h = size.height as i32;
    let x = area_x + area_w as i32 - w - EDGE_MARGIN;
    let y = area_y + area_h as i32 - h - EDGE_MARGIN - TRAY_CLEARANCE;
    window
        .set_position(PhysicalPosition::new(x.max(area_x), y.max(area_y)))
        .map_err(|e| format!("设置窗口位置失败: {e}"))?;
    Ok(())
}

pub fn monitor_work_area_near_cursor() -> Result<(i32, i32, i32, i32), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{POINT, RECT};
        use windows::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromPoint, MONITOR_DEFAULTTONEAREST, MONITORINFO,
        };
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        unsafe {
            let mut pt = POINT::default();
            GetCursorPos(&mut pt).map_err(|e| format!("GetCursorPos 失败: {e}"))?;
            let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(hmon, &mut info).as_bool() {
                return Err("GetMonitorInfo 失败".to_string());
            }
            let r: RECT = info.rcWork;
            Ok((r.left, r.top, r.right - r.left, r.bottom - r.top))
        }
    }
    #[cfg(not(windows))]
    {
        Ok((0, 0, 1920, 1080))
    }
}
