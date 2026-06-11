use std::fs;
use std::path::Path;

/// Capture our own window content (including the WebView2 surface) via the
/// Win32 PrintWindow API with PW_RENDERFULLCONTENT. This is the reliable way to
/// screenshot a Tauri window — xcap/BitBlt miss the DirectComposition surface.
#[cfg(windows)]
fn capture_hwnd_to_png(hwnd_isize: isize, path: &str) -> Result<(), String> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC,
        DeleteObject, GetDC, GetDIBits, HGDIOBJ, ReleaseDC, SelectObject, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    unsafe {
        let hwnd = HWND(hwnd_isize as *mut core::ffi::c_void);
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).map_err(|e| e.to_string())?;
        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;
        if w <= 0 || h <= 0 {
            return Err(format!("bad window size {w}x{h}"));
        }

        let hdc_win = GetDC(Some(hwnd));
        let hdc_mem = CreateCompatibleDC(Some(hdc_win));
        let hbmp = CreateCompatibleBitmap(hdc_win, w, h);
        let old = SelectObject(hdc_mem, HGDIOBJ(hbmp.0));

        // PW_RENDERFULLCONTENT = 0x00000002 — required for WebView2 content.
        let printed = PrintWindow(hwnd, hdc_mem, PRINT_WINDOW_FLAGS(2)).as_bool();

        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = core::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = w;
        bmi.bmiHeader.biHeight = -h; // top-down rows
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0;

        let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
        let scan = GetDIBits(
            hdc_mem,
            hbmp,
            0,
            h as u32,
            Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old);
        let _ = DeleteObject(HGDIOBJ(hbmp.0));
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(Some(hwnd), hdc_win);

        if scan == 0 || !printed {
            return Err(format!("capture failed (scan={scan}, printed={printed})"));
        }

        // BGRA -> RGBA, force opaque alpha.
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2);
            px[3] = 255;
        }
        let img = image::RgbaImage::from_raw(w as u32, h as u32, buf)
            .ok_or("image buffer size mismatch")?;
        img.save(path).map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Capture the MangaReader window to `path` (PNG). Uses PrintWindow on our own
/// HWND; falls back to a primary-monitor grab if that fails.
#[tauri::command]
pub fn capture_window(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        if capture_hwnd_to_png(hwnd.0 as isize, &path).is_ok() {
            return Ok(());
        }
    }

    // Fallback: capture the primary monitor.
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let mon = monitors.into_iter().next().ok_or("no monitor")?;
    let img = mon.capture_image().map_err(|e| e.to_string())?;
    img.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Write the done-signal file and optionally exit the process.
#[tauri::command]
pub fn finish_walkthrough(
    app: tauri::AppHandle,
    done_signal: Option<String>,
    exit_when_done: bool,
) -> Result<(), String> {
    if let Some(sig) = done_signal {
        if let Some(parent) = Path::new(&sig).parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&sig, b"done").map_err(|e| e.to_string())?;
    }
    if exit_when_done {
        app.exit(0);
    }
    Ok(())
}
