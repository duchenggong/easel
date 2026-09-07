import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { ChatMessage } from '../lib/store';
import { renderMarkdown } from '../lib/sanitize';
import { IconCopy, IconCheck, IconRetry } from './icons';

// ---- 智能体产物路径 → 对话内可直接渲染的媒体 ----
// 产物可能落在：① Web 内容库 outputs/（→ /api/media）
//              ② OpenClaw 工作区 outputs/（→ /api/agent-media）
const MEDIA_RE = /\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|m4v|mp3|wav|m4a|ogg|flac)$/i;
const VID_RE = /\.(mp4|webm|mov|m4v)$/i;
const AUD_RE = /\.(mp3|wav|m4a|ogg|flac)$/i;

function agentMediaUrl(path: string): string | null {
  const p = path.trim().replace(/^file:\/\//, '');
  const wsIdx = p.indexOf('/.openclaw-easel/workspace/outputs/');
  if (wsIdx >= 0) {
    const rel = p.slice(wsIdx + '/.openclaw-easel/workspace/outputs/'.length);
    return `/api/agent-media/${rel.split('/').map(encodeURIComponent).join('/')}`;
  }
  const outIdx = p.search(/\/outputs\//);
  if (outIdx >= 0) {
    const rel = p.slice(outIdx + '/outputs/'.length);
    return `/api/media/${rel.split('/').map(encodeURIComponent).join('/')}`;
  }
  return null;
}

/** 把消息里的「Attachment: 路径」/「附件：路径」行与本地路径图片引用，转为内嵌媒体。 */
function embedAgentMedia(text: string): string {
  // 1) 附件行整行替换为内嵌媒体（避免只显示路径文本）
  let out = text.replace(
    /(^|\n)[ \t]*(?:Attachment|附件)\s*[:：][ \t]*(\S+)/gi,
    (line: string, lead: string, path: string) => {
      if (!MEDIA_RE.test(path)) return line;
      const url = agentMediaUrl(path);
      if (!url) return line;
      if (VID_RE.test(path)) return `${lead}\n<video src="${url}" controls preload="metadata"></video>\n`;
      if (AUD_RE.test(path)) return `${lead}\n<audio src="${url}" controls></audio>\n`;
      return `${lead}\n![生成的图片](${url})\n`;
    },
  );
  // 2) markdown 图片引用了本地绝对路径（file:// 或裸路径）→ 改写为 API URL
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (tag: string, alt: string, src: string) => {
    if (/^(https?:|data:|\/api\/)/.test(src)) return tag;
    const url = agentMediaUrl(src);
    return url ? `![${alt}](${url})` : tag;
  });
  return out;
}

export interface BubbleActions {
  onCopy: () => void;
  onRetry?: () => void;    // 仅最后一轮可用（append-only：不改写历史）
  canModify: boolean;      // 流式中禁用 retry
}

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  thinking?: string;
  activity?: string;
  actions?: BubbleActions;
}

function ActionBar({ actions }: { actions: BubbleActions }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    actions.onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="msg-actions">
      <button className="msg-action" onClick={copy} title="复制">
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}<span>{copied ? '已复制' : '复制'}</span>
      </button>
      {actions.onRetry && actions.canModify && (
        <button className="msg-action" onClick={actions.onRetry} title="重新生成"><IconRetry size={14} /><span>重试</span></button>
      )}
    </div>
  );
}

export default function MessageBubble({ message, isStreaming, thinking, activity, actions }: MessageBubbleProps) {
  const html = useMemo(() => {
    if (message.role === 'user') return '';
    return renderMarkdown(embedAgentMedia(message.content));
  }, [message.content, message.role]);

  // ---- 点击放大（lightbox）----
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!zoomSrc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomSrc(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomSrc]);
  // 内嵌 HTML 里的 <img> 无法直接绑 React 事件，用事件委托拦截点击
  const onBubbleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      const src = (target as HTMLImageElement).getAttribute('src');
      if (src) { e.preventDefault(); setZoomSrc(src); }
    }
  };

  // ---- 用户消息 ----
  if (message.role === 'user') {
    // Attachment-only turns are intentionally invisible; the structured refs
    // remain in session state for retry but never leak paths into the chat UI.
    if (!message.content.trim()) return null;
    return (
      <div className="message-row user">
        <div className="msg-col user">
          <div className="message-bubble user">{message.content}</div>
          {actions && <ActionBar actions={actions} />}
        </div>
      </div>
    );
  }

  // ---- 助手消息 ----
  // 思考 / 活动：流式时用实时值；结束后用消息里持久化的值 —— 一直保留，不隐藏
  const effThinking = isStreaming ? (thinking || '') : (message.thinking || '');
  const liveActivity = isStreaming ? (activity || '') : '';
  const doneSteps = !isStreaming ? (message.activity || '') : '';

  const livePanel = (effThinking || liveActivity || doneSteps) ? (
    <div className="live-panel">
      {liveActivity && (
        <div className="live-activity"><span className="live-pulse" />{liveActivity}</div>
      )}
      {doneSteps && (
        <details className="thinking-block">
          <summary>🧠 执行过程（{doneSteps.split('\n').length} 步）</summary>
          <div className="thinking-text">{doneSteps}</div>
        </details>
      )}
      {effThinking && (
        <details className="thinking-block" open={isStreaming && !message.content}>
          <summary>💭 思考过程</summary>
          <div className="thinking-text">{effThinking}</div>
        </details>
      )}
    </div>
  ) : null;

  // 等待回复中（还没有正文、思考、活动）
  if (isStreaming && !message.content && !effThinking && !liveActivity) {
    return (
      <div className="message-row assistant">
        <div className="message-bubble assistant">
          <div className="typing-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-row assistant">
      <div className="msg-col assistant">
        <div className="message-bubble assistant">
          {livePanel}
          {message.content && <div onClick={onBubbleClick} dangerouslySetInnerHTML={{ __html: html }} />}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
        {actions && !isStreaming && <ActionBar actions={actions} />}
      </div>
      {zoomSrc && (
        <div className="media-lightbox" onClick={() => setZoomSrc(null)}>
          <img src={zoomSrc} alt="预览" />
          <div className="media-lightbox-hint">点击任意处或按 Esc 关闭</div>
        </div>
      )}
    </div>
  );
}
