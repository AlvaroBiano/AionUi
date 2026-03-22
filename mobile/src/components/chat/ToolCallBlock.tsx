import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '../ui/ThemedText';
import { useTranslation } from 'react-i18next';
import { useThemeColor } from '../../hooks/useThemeColor';
import { MarkdownContent } from './MarkdownContent';

type ToolCallBlockProps = {
  content: any;
  type: 'tool_call' | 'tool_group' | 'acp_tool_call' | 'codex_tool_call';
};

export function useStatusIcons() {
  const tint = useThemeColor({}, 'tint');
  const success = useThemeColor({}, 'success');
  const error = useThemeColor({}, 'error');
  const warning = useThemeColor({}, 'warning');
  const icon = useThemeColor({}, 'icon');

  const purple = useThemeColor({}, 'purple');

  return {
    Executing: { icon: 'play-circle' as const, color: tint },
    Success: { icon: 'checkmark-circle' as const, color: success },
    Error: { icon: 'close-circle' as const, color: error },
    Canceled: { icon: 'remove-circle' as const, color: icon },
    Pending: { icon: 'time' as const, color: warning },
    Confirming: { icon: 'help-circle' as const, color: purple },
    executing: { icon: 'play-circle' as const, color: tint },
    success: { icon: 'checkmark-circle' as const, color: success },
    error: { icon: 'close-circle' as const, color: error },
    pending: { icon: 'time' as const, color: warning },
    canceled: { icon: 'remove-circle' as const, color: icon },
  };
}

// Map ACP status values to mobile icon keys
export function mapAcpStatus(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'executing';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'pending':
    default:
      return 'pending';
  }
}

function acpKindDisplayName(kind: string | undefined, t: any): string {
  switch (kind) {
    case 'edit':
      return t('chat.fileEdit');
    case 'read':
      return t('chat.fileRead');
    case 'execute':
      return t('chat.shellCommand');
    default:
      return kind || '';
  }
}

export function ToolCallBlock({ content, type }: ToolCallBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const iconColor = useThemeColor({}, 'icon');
  const statusIcons = useStatusIcons();
  const codeBackground = useThemeColor({}, 'codeBackground');

  if (type === 'tool_group' && Array.isArray(content)) {
    return (
      <View style={[styles.container, { backgroundColor: surface }]}>
        {content.map((tool: any, i: number) => (
          <ToolItem key={tool.callId || i} tool={tool} surface={surface} border={border} iconColor={iconColor} />
        ))}
      </View>
    );
  }

  if (type === 'tool_call') {
    return (
      <View style={[styles.container, { backgroundColor: surface }]}>
        <ToolItem
          tool={{
            name: content.name,
            description: content.name,
            status: content.status === 'success' ? 'Success' : content.status === 'error' ? 'Error' : 'Executing',
            callId: content.callId,
          }}
          surface={surface}
          border={border}
          iconColor={iconColor}
        />
      </View>
    );
  }

  // codex_tool_call — check for special subtypes
  if (type === 'codex_tool_call') {
    const subtype = content.subtype;

    if (subtype === 'web_search_begin' || subtype === 'web_search_end') {
      return <WebSearchBlock content={content} />;
    }

    if (subtype === 'turn_diff') {
      return <DiffBlock content={content} />;
    }

    if (subtype === 'exec_command_begin' || subtype === 'exec_command_output_delta' || subtype === 'exec_command_end') {
      return <ExecCommandBlock content={content} />;
    }

    if (subtype === 'patch_apply_begin' || subtype === 'patch_apply_end') {
      return <PatchApplyBlock content={content} />;
    }

    if (subtype === 'mcp_tool_call_begin' || subtype === 'mcp_tool_call_end') {
      return <McpToolCallBlock content={content} />;
    }
  }

  // acp_tool_call — extract from nested update structure
  if (type === 'acp_tool_call' && content.update) {
    const update = content.update;
    const acpStatus = mapAcpStatus(update.status || 'pending');
    const title = update.title || acpKindDisplayName(update.kind, t) || t('chat.toolCall');
    const info = statusIcons[acpStatus as keyof typeof statusIcons] || statusIcons.pending;
    const hasDetail = update.rawInput || (update.content && update.content.length > 0) || update.description;

    return (
      <View style={[styles.container, { backgroundColor: surface }]}>
        <TouchableOpacity
          style={[styles.item, { borderBottomColor: border }]}
          onPress={() => hasDetail && setExpanded(!expanded)}
          activeOpacity={hasDetail ? 0.7 : 1}
        >
          <Ionicons name={info.icon} size={18} color={info.color} />
          <ThemedText style={styles.toolName} numberOfLines={expanded ? undefined : 1}>
            {title}
          </ThemedText>
          {hasDetail && <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={iconColor} />}
        </TouchableOpacity>
        {expanded && (
          <View style={[styles.detail, { backgroundColor: surface }]}>
            {update.rawInput && (
              <View style={[styles.codeBlock, { backgroundColor: codeBackground }]}>
                <ThemedText style={styles.codeText}>
                  {update.kind === 'execute' && update.rawInput.command
                    ? `$ ${typeof update.rawInput.command === 'string' ? update.rawInput.command : JSON.stringify(update.rawInput.command)}`
                    : JSON.stringify(update.rawInput, null, 2)}
                </ThemedText>
              </View>
            )}
            {update.content?.map((item: any, idx: number) => (
              <React.Fragment key={idx}>
                {item.type === 'diff' && (item.oldText != null || item.newText) && <AcpDiffItem item={item} />}
                {item.type === 'content' && item.content?.text && <MarkdownContent content={item.content.text} />}
              </React.Fragment>
            ))}
            {!update.rawInput && (!update.content || update.content.length === 0) && update.description && (
              <ThemedText type='caption'>{update.description}</ThemedText>
            )}
          </View>
        )}
      </View>
    );
  }

  // codex_tool_call or acp_tool_call fallback (generic)
  const status = content.status || 'pending';
  const title = content.title || content.description || content.kind || t('chat.toolCall');
  const info = statusIcons[status as keyof typeof statusIcons] || statusIcons.pending;

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      <TouchableOpacity
        style={[styles.item, { borderBottomColor: border }]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <Ionicons name={info.icon} size={18} color={info.color} />
        <ThemedText style={styles.toolName} numberOfLines={expanded ? undefined : 1}>
          {title}
        </ThemedText>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={iconColor} />
      </TouchableOpacity>
      {expanded && content.description && (
        <View style={[styles.detail, { backgroundColor: surface }]}>
          <ThemedText type='caption'>{content.description}</ThemedText>
        </View>
      )}
    </View>
  );
}

// --- Web Search Display ---

export function WebSearchBlock({ content }: { content: any }) {
  const { t } = useTranslation();
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const statusIcons = useStatusIcons();
  const status = content.status || 'pending';
  const info = statusIcons[status as keyof typeof statusIcons] || statusIcons.pending;

  const isEnd = content.subtype === 'web_search_end';
  const query = isEnd && content.data?.query;

  const displayTitle = isEnd
    ? query
      ? `${t('chat.webSearch')}: ${query}`
      : t('chat.webSearchCompleted')
    : t('chat.webSearchStarted');

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      <View style={[styles.item, { borderBottomColor: border }]}>
        <Ionicons name='search' size={18} color={tint} />
        <Ionicons name={info.icon} size={14} color={info.color} />
        <ThemedText style={styles.toolName} numberOfLines={2}>
          {displayTitle}
        </ThemedText>
      </View>
      {isEnd && query && (
        <View style={[styles.detail, { backgroundColor: surface }]}>
          <ThemedText type='caption' style={{ opacity: 0.7 }}>
            {t('chat.searchQuery')}
          </ThemedText>
          <View style={[styles.queryBox, { borderColor: border }]}>
            <ThemedText style={styles.queryText}>{query}</ThemedText>
          </View>
        </View>
      )}
    </View>
  );
}

// --- Diff Display ---

function parseDiffStats(unifiedDiff: string): { fileName: string; insertions: number; deletions: number } {
  let fileName = '';
  let insertions = 0;
  let deletions = 0;

  const lines = unifiedDiff.split('\n');
  for (const line of lines) {
    if (!fileName) {
      // Try to extract file path from diff header
      const bMatch = line.match(/^\+\+\+ b\/(.+)/);
      if (bMatch) {
        fileName = bMatch[1];
        continue;
      }
      const aMatch = line.match(/^--- a\/(.+)/);
      if (aMatch && !fileName) {
        fileName = aMatch[1];
        continue;
      }
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      insertions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }

  // Fallback: extract filename from path
  if (fileName) {
    const parts = fileName.split('/');
    fileName = parts[parts.length - 1];
  }

  return { fileName: fileName || 'file', insertions, deletions };
}

export function DiffBlock({ content }: { content: any }) {
  const [expanded, setExpanded] = useState(false);
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const success = useThemeColor({}, 'success');
  const error = useThemeColor({}, 'error');
  const iconColor = useThemeColor({}, 'icon');
  const codeBackground = useThemeColor({}, 'codeBackground');
  const text = useThemeColor({}, 'text');

  const unifiedDiff = content.data?.unified_diff || '';
  const stats = parseDiffStats(unifiedDiff);

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      <TouchableOpacity
        style={[styles.item, { borderBottomColor: border }]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={[styles.diffDot, { backgroundColor: success }]} />
        <ThemedText style={styles.toolName} numberOfLines={1}>
          {stats.fileName}
        </ThemedText>
        <View style={styles.diffStats}>
          {stats.insertions > 0 && (
            <ThemedText style={[styles.diffStat, { color: success }]}>+{stats.insertions}</ThemedText>
          )}
          {stats.deletions > 0 && (
            <ThemedText style={[styles.diffStat, { color: error }]}>-{stats.deletions}</ThemedText>
          )}
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={iconColor} />
      </TouchableOpacity>
      {expanded && unifiedDiff && (
        <View style={[styles.diffContent, { backgroundColor: codeBackground }]}>
          {unifiedDiff.split('\n').map((line: string, i: number) => {
            let lineColor = text;
            if (line.startsWith('+') && !line.startsWith('+++')) lineColor = success;
            else if (line.startsWith('-') && !line.startsWith('---')) lineColor = error;
            else if (line.startsWith('@@')) lineColor = iconColor;

            return (
              <ThemedText key={i} style={[styles.diffLine, { color: lineColor }]} numberOfLines={1}>
                {line}
              </ThemedText>
            );
          })}
        </View>
      )}
    </View>
  );
}

// --- ACP Diff Item ---

function AcpDiffItem({ item }: { item: any }) {
  const [expanded, setExpanded] = useState(false);
  const border = useThemeColor({}, 'border');
  const success = useThemeColor({}, 'success');
  const iconColor = useThemeColor({}, 'icon');
  const codeBackground = useThemeColor({}, 'codeBackground');
  const textColor = useThemeColor({}, 'text');

  const fullPath = item.path || 'file';
  const fileName = fullPath.split('/').pop() || fullPath;
  const lines = item.newText ? item.newText.split('\n') : [];

  return (
    <View style={{ marginTop: 4 }}>
      <TouchableOpacity
        style={[styles.item, { borderBottomColor: border }]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={[styles.diffDot, { backgroundColor: success }]} />
        <ThemedText style={styles.toolName} numberOfLines={1}>
          {fileName}
        </ThemedText>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={iconColor} />
      </TouchableOpacity>
      {expanded && lines.length > 0 && (
        <View style={[styles.diffContent, { backgroundColor: codeBackground }]}>
          {lines.slice(0, 50).map((line: string, i: number) => (
            <ThemedText key={i} style={[styles.diffLine, { color: textColor }]} numberOfLines={1}>
              {line}
            </ThemedText>
          ))}
          {lines.length > 50 && (
            <ThemedText style={[styles.diffLine, { color: iconColor, fontStyle: 'italic' }]}>
              … {lines.length - 50} more lines
            </ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

// --- Exec Command Display (Codex) ---

function ExecCommandBlock({ content }: { content: any }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const iconColor = useThemeColor({}, 'icon');
  const codeBackground = useThemeColor({}, 'codeBackground');
  const success = useThemeColor({}, 'success');
  const error = useThemeColor({}, 'error');
  const statusIcons = useStatusIcons();

  const { subtype, data, status, title } = content;
  const info = statusIcons[status as keyof typeof statusIcons] || statusIcons.pending;

  const command = data?.command;
  const commandStr = Array.isArray(command) ? command.join(' ') : command || '';
  const displayTitle = title || commandStr || t('chat.shellCommand');
  const isEnd = subtype === 'exec_command_end';
  const exitCode = isEnd && data?.exit_code !== undefined ? data.exit_code : null;

  // Collect output from content array
  const outputParts: string[] = [];
  if (content.content && Array.isArray(content.content)) {
    for (const c of content.content) {
      if (c.type === 'output' && c.output) outputParts.push(c.output);
      if (c.type === 'text' && c.text) outputParts.push(c.text);
    }
  }
  const output = outputParts.join('');
  const hasDetail = commandStr || output;

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      <TouchableOpacity
        style={[styles.item, { borderBottomColor: border }]}
        onPress={() => hasDetail && setExpanded(!expanded)}
        activeOpacity={hasDetail ? 0.7 : 1}
      >
        <Ionicons name={info.icon} size={18} color={info.color} />
        <ThemedText style={styles.toolName} numberOfLines={1}>
          {displayTitle}
        </ThemedText>
        {exitCode !== null && (
          <ThemedText style={[styles.diffStat, { color: exitCode === 0 ? success : error }]}>
            {t('chat.exitCode', { code: exitCode })}
          </ThemedText>
        )}
        {hasDetail && <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={iconColor} />}
      </TouchableOpacity>
      {expanded && (
        <View style={[styles.detail, { backgroundColor: surface }]}>
          {commandStr ? (
            <View style={[styles.codeBlock, { backgroundColor: codeBackground }]}>
              <ThemedText style={styles.codeText}>$ {commandStr}</ThemedText>
            </View>
          ) : null}
          {output ? (
            <View style={[styles.codeBlock, { backgroundColor: codeBackground, marginTop: 4 }]}>
              <ThemedText style={styles.codeText} numberOfLines={30}>
                {output}
              </ThemedText>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

// --- Patch Apply Display (Codex) ---

function PatchApplyBlock({ content }: { content: any }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const iconColor = useThemeColor({}, 'icon');
  const success = useThemeColor({}, 'success');
  const error = useThemeColor({}, 'error');
  const tint = useThemeColor({}, 'tint');
  const statusIcons = useStatusIcons();

  const { subtype, data, status, title } = content;
  const info = statusIcons[status as keyof typeof statusIcons] || statusIcons.pending;
  const isBegin = subtype === 'patch_apply_begin';
  const displayTitle = title || (isBegin ? t('chat.applyingPatch') : t('chat.patchApplied'));

  const changes = isBegin && data?.changes && typeof data.changes === 'object' ? Object.entries(data.changes) : [];

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      <TouchableOpacity
        style={[styles.item, { borderBottomColor: border }]}
        onPress={() => changes.length > 0 && setExpanded(!expanded)}
        activeOpacity={changes.length > 0 ? 0.7 : 1}
      >
        <Ionicons name={info.icon} size={18} color={info.color} />
        <ThemedText style={styles.toolName} numberOfLines={1}>
          {displayTitle}
        </ThemedText>
        {changes.length > 0 && (
          <>
            <ThemedText style={[styles.diffStat, { color: tint }]}>
              {changes.length} file{changes.length !== 1 ? 's' : ''}
            </ThemedText>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={iconColor} />
          </>
        )}
      </TouchableOpacity>
      {expanded && changes.length > 0 && (
        <View style={[styles.detail, { backgroundColor: surface }]}>
          {changes.map(([file, change]: [string, any], i: number) => {
            const action =
              typeof change === 'object' && change !== null ? change.type || change.action || 'modify' : 'modify';
            const actionColor = action === 'create' ? success : action === 'delete' ? error : tint;
            return (
              <View key={i} style={styles.patchFileRow}>
                <ThemedText style={[styles.diffStat, { color: actionColor }]}>{action}</ThemedText>
                <ThemedText type='caption' numberOfLines={1} style={{ flex: 1 }}>
                  {file}
                </ThemedText>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// --- MCP Tool Display (Codex) ---

function McpToolCallBlock({ content }: { content: any }) {
  const [expanded, setExpanded] = useState(false);
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const iconColor = useThemeColor({}, 'icon');
  const codeBackground = useThemeColor({}, 'codeBackground');
  const statusIcons = useStatusIcons();

  const { subtype, data, status, title } = content;
  const info = statusIcons[status as keyof typeof statusIcons] || statusIcons.pending;
  const inv = data?.invocation || {};
  const toolName = inv.tool || inv.name || inv.method || 'MCP Tool';
  const displayTitle = title || `MCP: ${toolName}`;
  const isEnd = subtype === 'mcp_tool_call_end';
  const hasDetail = inv.arguments || (isEnd && data?.result);

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      <TouchableOpacity
        style={[styles.item, { borderBottomColor: border }]}
        onPress={() => hasDetail && setExpanded(!expanded)}
        activeOpacity={hasDetail ? 0.7 : 1}
      >
        <Ionicons name={info.icon} size={18} color={info.color} />
        <ThemedText style={styles.toolName} numberOfLines={1}>
          {displayTitle}
        </ThemedText>
        {hasDetail && <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={iconColor} />}
      </TouchableOpacity>
      {expanded && (
        <View style={[styles.detail, { backgroundColor: surface }]}>
          {inv.arguments && (
            <View style={[styles.codeBlock, { backgroundColor: codeBackground }]}>
              <ThemedText style={styles.codeText}>{JSON.stringify(inv.arguments, null, 2)}</ThemedText>
            </View>
          )}
          {isEnd && data?.result && (
            <View style={[styles.codeBlock, { backgroundColor: codeBackground, marginTop: 4 }]}>
              <ThemedText style={styles.codeText} numberOfLines={20}>
                {typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2)}
              </ThemedText>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// --- Tool Item ---

export function ToolItem({
  tool,
  surface,
  border,
  iconColor,
}: {
  tool: any;
  surface: string;
  border: string;
  iconColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusIcons = useStatusIcons();
  const status = tool.status || 'Executing';
  const info = statusIcons[status as keyof typeof statusIcons] || statusIcons.Pending;

  return (
    <View>
      <TouchableOpacity
        style={[styles.item, { borderBottomColor: border }]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <Ionicons name={info.icon} size={18} color={info.color} />
        <ThemedText style={styles.toolName} numberOfLines={1}>
          {tool.description || tool.name || 'Tool'}
        </ThemedText>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={iconColor} />
      </TouchableOpacity>
      {expanded && (
        <View style={[styles.detail, { backgroundColor: surface }]}>
          {tool.name && <ThemedText type='caption'>{tool.name}</ThemedText>}
          {tool.resultDisplay != null && tool.resultDisplay !== '' && (
            <ThemedText type='caption' numberOfLines={8}>
              {typeof tool.resultDisplay === 'string'
                ? tool.resultDisplay
                : JSON.stringify(tool.resultDisplay, null, 2)}
            </ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    overflow: 'hidden',
    marginVertical: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolName: {
    flex: 1,
    fontSize: 14,
  },
  detail: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  queryBox: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
  },
  queryText: {
    fontSize: 14,
    fontWeight: '500',
  },
  diffDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  diffStats: {
    flexDirection: 'row',
    gap: 6,
  },
  diffStat: {
    fontSize: 12,
    fontWeight: '600',
  },
  diffContent: {
    padding: 10,
    maxHeight: 300,
  },
  diffLine: {
    fontFamily: 'ui-monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  codeBlock: {
    borderRadius: 6,
    padding: 10,
    overflow: 'hidden',
  },
  codeText: {
    fontFamily: 'ui-monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  patchFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
});
