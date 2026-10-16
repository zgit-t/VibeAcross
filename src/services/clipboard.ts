/**
 * 复制文本到系统剪贴板。
 *
 * 优先使用异步剪贴板 API（Tauri WebView 为安全上下文）；不可用时回退到
 * 临时的只读文本域 + `document.execCommand("copy")`。返回是否成功，调用方据此提示。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 忽略，继续尝试回退方案。
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
