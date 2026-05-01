/**
 * @license
 * Copyright 2025 AlvaroBiano
 * SPDX-License-Identifier: Apache-2.0
 */

import { Typography } from '@arco-design/web-react';
import { Code, Info } from '@icon-park/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownView from '@renderer/components/Markdown';
import styles from '../index.module.css';

interface PreviewSandboxProps {
  skillMarkdown: string;
}

const PreviewSandbox: React.FC<PreviewSandboxProps> = ({ skillMarkdown }) => {
  const { t } = useTranslation();

  // Parse frontmatter to extract metadata
  const { frontmatter, content } = useMemo(() => {
    const frontmatterMatch = skillMarkdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (frontmatterMatch) {
      const [, frontmatterStr, contentPart] = frontmatterMatch;
      const meta: Record<string, string | string[]> = {};

      // Simple YAML parsing
      const lines = frontmatterStr.split('\n');
      let currentKey = '';
      let currentValue: string | string[] = '';
      let isInList = false;
      const listItems: string[] = [];

      for (const line of lines) {
        if (line.match(/^(\w+):\s*$/)) {
          // Key with empty value
          if (currentKey) {
            meta[currentKey] = isInList ? listItems : currentValue;
          }
          currentKey = line.match(/^(\w+):\s*$/)?.[1] || '';
          currentValue = '';
          isInList = false;
          listItems.length = 0;
        } else if (line.match(/^\s+-\s+(.+)/)) {
          // List item
          const item = line.match(/^\s+-\s+(.+)/)?.[1] || '';
          listItems.push(item);
          isInList = true;
        } else if (line.match(/^\s+(\w+):\s*"([^"]*)"/)) {
          // Key with quoted value on same line
          const [, key, value] = line.match(/^\s+(\w+):\s*"([^"]*)"/) || [];
          if (currentKey) {
            meta[currentKey] = isInList ? listItems : currentValue;
          }
          currentKey = key;
          currentValue = value;
          isInList = false;
        } else if (line.match(/^\s+(\w+):\s*(.+)/)) {
          // Key with value on same line
          const [, key, value] = line.match(/^\s+(\w+):\s*(.+)/) || [];
          if (currentKey) {
            meta[currentKey] = isInList ? listItems : currentValue;
          }
          currentKey = key;
          currentValue = value.replace(/^"|"$/g, ''); // Remove quotes
          isInList = false;
        }
      }

      if (currentKey) {
        meta[currentKey] = isInList ? listItems : currentValue;
      }

      return { frontmatter: meta, content: contentPart };
    }
    return { frontmatter: {}, content: skillMarkdown };
  }, [skillMarkdown]);

  return (
    <div className={styles.previewContainer}>
      {/* Skill Info Banner */}
      <div className={styles.sandboxInfo}>
        <div className={styles.sandboxInfoIcon}>
          <Info theme='outline' size={16} />
        </div>
        <div className={styles.sandboxInfoContent}>
          <Typography.Text strong className={styles.sandboxInfoTitle}>
            {t('skillStudio.previewSandbox', { defaultValue: 'Skill Preview Sandbox' })}
          </Typography.Text>
          <Typography.Text className={styles.sandboxInfoText}>
            {t('skillStudio.previewSandboxDesc', {
              defaultValue: 'This is how your skill will appear when rendered by the system',
            })}
          </Typography.Text>
        </div>
      </div>

      {/* Frontmatter Display */}
      <div className={styles.frontmatterSection}>
        <h4 className={styles.frontmatterTitle}>
          <Code theme='outline' size={14} />
          {t('skillStudio.frontmatter', { defaultValue: 'Frontmatter Metadata' })}
        </h4>
        <div className={styles.frontmatterGrid}>
          {Object.entries(frontmatter).map(([key, value]) => (
            <div key={key} className={styles.frontmatterItem}>
              <span className={styles.frontmatterKey}>{key}:</span>
              <span className={styles.frontmatterValue}>
                {Array.isArray(value) ? (
                  <span className={styles.frontmatterList}>
                    {value.map((v, i) => (
                      <code key={i} className={styles.frontmatterListItem}>
                        {v}
                      </code>
                    ))}
                  </span>
                ) : (
                  <code className={styles.frontmatterString}>{value}</code>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Rendered Markdown Content */}
      <div className={styles.renderedContent}>
        <h4 className={styles.renderedTitle}>
          {t('skillStudio.renderedContent', { defaultValue: 'Rendered Content' })}
        </h4>
        <div className={styles.markdownPreview}>
          <MarkdownView allowHtml>{skillMarkdown}</MarkdownView>
        </div>
      </div>

      {/* Raw Content Toggle */}
      <div className={styles.rawSection}>
        <details className={styles.rawDetails}>
          <summary className={styles.rawSummary}>
            <Code theme='outline' size={14} />
            {t('skillStudio.rawMarkdown', { defaultValue: 'Raw Markdown' })}
          </summary>
          <pre className={styles.rawContent}>
            <code>{skillMarkdown}</code>
          </pre>
        </details>
      </div>
    </div>
  );
};

export default PreviewSandbox;
