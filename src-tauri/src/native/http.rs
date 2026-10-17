//! 极简的 localhost HTTP/1.1 客户端。
//!
//! 只服务于一个用途：与本机 `opencode serve` 暴露的官方 HTTP 服务通信。
//! 因此刻意保持最小实现（无第三方依赖、仅明文、仅本机回环地址），并按
//! `Content-Length` / `Transfer-Encoding: chunked` 正确分帧读取响应体，
//! 不依赖对端是否关闭连接（避免 keep-alive 导致的读取阻塞）。
//!
//! 安全边界：仅连接 `127.0.0.1`，不发起任何外部网络请求。

use crate::error::AppError;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// 一次 HTTP 响应。
#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

/// 向本机回环地址发起一次 HTTP 请求。
///
/// `path` 必须包含查询串（如 `/session?directory=...`），由调用方负责编码。
pub fn request(
    host: &str,
    port: u16,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<HttpResponse, AppError> {
    if host != "127.0.0.1" && host != "localhost" {
        return Err(AppError::new(
            "NATIVE_HTTP_HOST",
            "本地原生会话服务只允许通过本机回环地址访问。",
        ));
    }
    let address = format!("{host}:{port}");
    let mut stream = TcpStream::connect(&address).map_err(|error| {
        AppError::new(
            "NATIVE_HTTP_CONNECT",
            format!("无法连接本地原生会话服务：{error}"),
        )
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| AppError::new("NATIVE_HTTP_TIMEOUT", error.to_string()))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| AppError::new("NATIVE_HTTP_TIMEOUT", error.to_string()))?;

    let mut payload = String::new();
    payload.push_str(&format!("{method} {path} HTTP/1.1\r\n"));
    payload.push_str(&format!("Host: {host}:{port}\r\n"));
    payload.push_str("Accept: application/json\r\n");
    payload.push_str("Connection: close\r\n");
    if let Some(body) = body {
        payload.push_str("Content-Type: application/json\r\n");
        payload.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    payload.push_str("\r\n");
    if let Some(body) = body {
        payload.push_str(body);
    }

    stream
        .write_all(payload.as_bytes())
        .map_err(|error| AppError::new("NATIVE_HTTP_WRITE", format!("发送请求失败：{error}")))?;
    stream
        .flush()
        .map_err(|error| AppError::new("NATIVE_HTTP_WRITE", format!("发送请求失败：{error}")))?;

    let mut reader = BufReader::new(stream);

    let mut status_line = String::new();
    reader
        .read_line(&mut status_line)
        .map_err(|error| AppError::new("NATIVE_HTTP_READ", format!("读取响应失败：{error}")))?;
    let status = parse_status_line(&status_line)?;

    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| AppError::new("NATIVE_HTTP_READ", format!("读取响应失败：{error}")))?;
        if read == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        headers.push(line);
    }

    let chunked = headers.iter().any(|line| {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("transfer-encoding:") && lower.contains("chunked")
    });
    let content_length = headers.iter().find_map(|line| {
        let lower = line.to_ascii_lowercase();
        lower
            .starts_with("content-length:")
            .then(|| line.split_once(':').map(|(_, value)| value.trim().to_string()))
            .flatten()
            .and_then(|value| value.parse::<usize>().ok())
    });

    let body = if chunked {
        read_chunked(&mut reader)?
    } else if let Some(length) = content_length {
        let mut buffer = vec![0u8; length];
        reader
            .read_exact(&mut buffer)
            .map_err(|error| AppError::new("NATIVE_HTTP_READ", format!("读取响应失败：{error}")))?;
        String::from_utf8_lossy(&buffer).into_owned()
    } else {
        String::new()
    };

    Ok(HttpResponse { status, body })
}

fn parse_status_line(status_line: &str) -> Result<u16, AppError> {
    status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| AppError::new("NATIVE_HTTP_INVALID", "本地服务返回了无法解析的响应状态。"))
}

/// 读取分块传输编码的响应体。
fn read_chunked<R: BufRead>(reader: &mut R) -> Result<String, AppError> {
    let mut out = String::new();
    loop {
        let mut size_line = String::new();
        reader
            .read_line(&mut size_line)
            .map_err(|error| AppError::new("NATIVE_HTTP_READ", format!("读取响应失败：{error}")))?;
        let size = usize::from_str_radix(size_line.trim(), 16).unwrap_or(0);
        if size == 0 {
            // 消费结尾的 CRLF / 可选 trailer。
            let mut trailer = String::new();
            let _ = reader.read_line(&mut trailer);
            break;
        }
        let mut buffer = vec![0u8; size];
        reader
            .read_exact(&mut buffer)
            .map_err(|error| AppError::new("NATIVE_HTTP_READ", format!("读取响应失败：{error}")))?;
        out.push_str(&String::from_utf8_lossy(&buffer));
        let mut crlf = [0u8; 2];
        let _ = reader.read_exact(&mut crlf);
    }
    Ok(out)
}

/// 解析完整的 HTTP 响应文本（响应头 + 响应体）。仅用于单元测试。
pub fn parse_response(text: &str) -> Result<HttpResponse, AppError> {
    let (head, raw_body) = match text.find("\r\n\r\n") {
        Some(index) => (&text[..index], &text[index + 4..]),
        None => (text, ""),
    };
    let status = parse_status_line(head.lines().next().unwrap_or(""))?;
    let chunked = head.lines().any(|line| {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("transfer-encoding:") && lower.contains("chunked")
    });
    let body = if chunked {
        decode_chunked(raw_body)
    } else {
        raw_body.to_string()
    };
    Ok(HttpResponse { status, body })
}

/// 解码分块传输编码的响应体（纯文本，供测试使用）。
fn decode_chunked(raw: &str) -> String {
    let mut rest = raw;
    let mut out = String::new();
    while let Some(line_end) = rest.find("\r\n") {
        let size = usize::from_str_radix(rest[..line_end].trim(), 16).unwrap_or(0);
        rest = &rest[line_end + 2..];
        if size == 0 {
            break;
        }
        if rest.len() < size {
            out.push_str(rest);
            break;
        }
        out.push_str(&rest[..size]);
        rest = &rest[size..];
        if let Some(stripped) = rest.strip_prefix("\r\n") {
            rest = stripped;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_content_length_response() {
        let response = parse_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 13\r\n\r\n{\"ok\":true}\r\n",
        )
        .unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"ok\":true}\r\n");
    }

    #[test]
    fn parses_chunked_response() {
        let raw = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n7\r\n{\"a\":1}\r\n0\r\n\r\n";
        let response = parse_response(raw).unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"a\":1}");
    }

    #[test]
    fn rejects_invalid_status_line() {
        assert!(parse_response("garbage").is_err());
    }
}
