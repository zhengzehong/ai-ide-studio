import { X, FileText, Copy, Check } from 'lucide-react';
import type { FileContent } from '../../stores/filesystem.store';
import { useState } from 'react';
import { copyText } from '../../utils/copy-text';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { FileAssetView } from './FileAssetView';

export function FilePreview({ file, projectId, onClose }: { file: FileContent; projectId?: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(file.content);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isMarkdown = ['.md', '.mdx'].includes(file.extension);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-0)', borderLeft: '1px solid var(--border)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-1)', flexShrink: 0,
      }}>
        <FileText size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        <span style={{ fontSize: 14, color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.path}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>
          {formatSize(file.size)} · {file.language}
        </span>
        {file.kind === 'text' && <button onClick={handleCopy} title="复制内容" style={iconBtn}>
          {copied ? <Check size={14} color="var(--green)" /> : <Copy size={14} />}
        </button>}
        <button onClick={onClose} title="关闭" style={iconBtn}>
          <X size={14} />
        </button>
      </div>

      {file.truncated && (
        <div style={{ padding: '6px 12px', background: 'var(--yellow-light, #fef9c3)', fontSize: 14, color: 'var(--yellow, #a16207)', borderBottom: '1px solid var(--border)' }}>
          文件过大，仅显示前 1MB 内容
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {projectId && (file.kind === 'image' || file.kind === 'audio' || file.kind === 'video') ? (
          <FileAssetView key={file.path} projectId={projectId} path={file.path} kind={file.kind} />
        ) : isMarkdown ? (
          <div style={{ padding: 16 }}>
            <MarkdownRenderer content={file.content} projectId={projectId ?? undefined} documentPath={file.path} />
          </div>
        ) : file.kind === 'binary' || !projectId && file.kind !== 'text' ? (
          <div style={{ padding: 24, color: 'var(--text-3)' }}>该文件类型暂不支持预览。</div>
        ) : (
          <pre style={{
            margin: 0, padding: 16, fontSize: 15, lineHeight: 1.6,
            fontFamily: 'var(--font-mono, "Fira Code", "Cascadia Code", monospace)',
            color: 'var(--text-1)', whiteSpace: 'pre', overflowX: 'auto',
            counterReset: 'line',
          }}>
            {file.content.split('\n').map((line, i) => (
              <div key={i} style={{ display: 'flex' }}>
                <span style={{
                  display: 'inline-block', width: 48, textAlign: 'right', paddingRight: 16,
                  color: 'var(--text-3)', opacity: 0.5, userSelect: 'none', flexShrink: 0,
                  fontSize: 14,
                }}>
                  {i + 1}
                </span>
                <span style={{ flex: 1 }}>{line || ' '}</span>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 6, border: 'none',
  background: 'transparent', color: 'var(--text-3)', cursor: 'pointer',
};
