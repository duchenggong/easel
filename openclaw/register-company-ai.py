#!/usr/bin/env python3
"""Easel — 注册公司 AI 网关 Provider 到 OpenClaw easel profile。

用法（项目根目录）：
    python3 openclaw/register-company-ai.py [--env-file .env] [--profile easel]

读取 .env 中的 COMPANY_AI_BASE_URL / COMPANY_AI_API_KEY / COMPANY_AI_MODEL，
把 company-ai Provider 原子写入 ~/.openclaw-<profile>/openclaw.json。

幂等：重复执行只覆盖同一 Provider 块；密钥永不完整回显。
主模型选择：.env 显式设置了 CLAUDE_MODEL 时尊重该值，否则默认 company-ai/<模型>。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

PLACEHOLDER_MARKS = ("REPLACE_ME", "your-key", "xxx", "替换", "占位")


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        # 去除可选的单/双引号
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def main() -> int:
    ap = argparse.ArgumentParser(description="注册公司 AI 网关 Provider（company-ai）")
    ap.add_argument("--env-file", default=None, help=".env 路径（默认 <项目根>/.env）")
    ap.add_argument("--profile", default="easel", help="OpenClaw profile（默认 easel）")
    args = ap.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    env_path = Path(args.env_file).resolve() if args.env_file else project_root / ".env"
    if not env_path.is_file():
        print(f"❌ 未找到 {env_path}", file=sys.stderr)
        return 1

    env = read_env(env_path)
    required = ["COMPANY_AI_BASE_URL", "COMPANY_AI_API_KEY", "COMPANY_AI_MODEL"]
    missing = [k for k in required if not env.get(k)]
    if missing:
        print(f"❌ .env 缺少配置：{', '.join(missing)}。请在 .env 中填好后再注册。", file=sys.stderr)
        return 1

    base_url = env["COMPANY_AI_BASE_URL"].rstrip("/")
    api_key = env["COMPANY_AI_API_KEY"]
    model = env["COMPANY_AI_MODEL"]
    for name, value in (("COMPANY_AI_BASE_URL", base_url),
                        ("COMPANY_AI_API_KEY", api_key),
                        ("COMPANY_AI_MODEL", model)):
        if any(mark in value for mark in PLACEHOLDER_MARKS):
            print(f"❌ {name} 含占位符，请填入真实值。", file=sys.stderr)
            return 1

    config_path = Path.home() / f".openclaw-{args.profile}" / "openclaw.json"
    if not config_path.is_file():
        print(f"❌ 未找到 {config_path}，请先运行 bash setup.sh 初始化 profile。",
              file=sys.stderr)
        return 1
    config = json.loads(config_path.read_text(encoding="utf-8"))

    # company-ai：公司 OpenAI 兼容网关（Bearer 鉴权），内网地址需允许私网请求
    config.setdefault("models", {}).setdefault("providers", {})
    config["models"]["providers"]["company-ai"] = {
        "baseUrl": base_url,
        "api": "openai-completions",
        "apiKey": api_key,
        "timeoutSeconds": 600,
        "request": {"allowPrivateNetwork": True},
        "models": [{
            "id": model,
            "name": model,
            "reasoning": True,
            "input": ["text"],
        }],
    }

    # 主模型：尊重 .env 显式声明的 CLAUDE_MODEL，否则默认公司模型
    primary = env.get("CLAUDE_MODEL", "").strip() or f"company-ai/{model}"
    config.setdefault("agents", {}).setdefault("defaults", {}).setdefault("model", {})
    config["agents"]["defaults"]["model"]["primary"] = primary

    # 原子写入：OpenClaw 拒绝中间态不完整的 provider 配置
    config_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(config_path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, config_path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    os.chmod(config_path, 0o600)

    print(f"✅ company-ai Provider 已注册 → {config_path}")
    print(f"   baseUrl: {base_url}")
    print(f"   model:   {model}")
    print(f"   primary: {primary}")
    print(f"   apiKey:  {api_key[:5]}…{api_key[-4:]}（已写入，未完整显示）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
