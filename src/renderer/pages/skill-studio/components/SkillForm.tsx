/**
 * @license
 * Copyright 2025 AlvaroBiano
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Message, Tag, Typography } from '@arco-design/web-react';
import { Plus, Block } from '@icon-park/react';
import React, { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownView from '@renderer/components/Markdown';
import type { SkillMeta } from '../SkillStudioPage';
import styles from '../index.module.css';

const { TextArea } = Input;

export interface SkillData {
  meta: SkillMeta;
  content: string;
}

interface SkillFormProps {
  meta: SkillMeta;
  content: string;
  onMetaChange: (meta: SkillMeta) => void;
  onContentChange: (content: string) => void;
}

const SkillForm = forwardRef<{ getSkillData: () => SkillData }, SkillFormProps>(
  ({ meta, content, onMetaChange, onContentChange }, ref) => {
    const { t } = useTranslation();
    const [newTrigger, setNewTrigger] = useState('');
    const [viewMode, setViewMode] = useState<'edit' | 'split' | 'preview'>('edit');

    useImperativeHandle(ref, () => ({
      getSkillData: () => ({ meta, content }),
    }));

    const handleNameChange = useCallback(
      (value: string) => {
        onMetaChange({ ...meta, name: value });
      },
      [meta, onMetaChange]
    );

    const handleDescriptionChange = useCallback(
      (value: string) => {
        onMetaChange({ ...meta, description: value });
      },
      [meta, onMetaChange]
    );

    const handleAddTrigger = useCallback(() => {
      const trigger = newTrigger.trim();
      if (!trigger) return;
      if (meta.triggers.includes(trigger)) {
        Message.warning(t('skillStudio.errors.duplicateTrigger', { defaultValue: 'Trigger already exists' }));
        return;
      }
      onMetaChange({ ...meta, triggers: [...meta.triggers, trigger] });
      setNewTrigger('');
    }, [meta, newTrigger, onMetaChange, t]);

    const handleRemoveTrigger = useCallback(
      (index: number) => {
        const newTriggers = [...meta.triggers];
        newTriggers.splice(index, 1);
        onMetaChange({ ...meta, triggers: newTriggers });
      },
      [meta, onMetaChange]
    );

    const handleTriggerKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void handleAddTrigger();
        }
      },
      [handleAddTrigger]
    );

    const handleContentChange = useCallback(
      (value: string) => {
        onContentChange(value);
      },
      [onContentChange]
    );

    const previewMarkdown = `---
name: ${meta.name}
description: "${meta.description}"
triggers:
${meta.triggers.map((t) => `  - ${t}`).join('\n')}
---

${content}`;

    return (
      <div className={styles.formContainer}>
        <div className={styles.formLayout}>
          {/* Left Panel - Form Fields */}
          <div className={styles.formPanel}>
            {/* Basic Info Section */}
            <div className={styles.formSection}>
              <h3 className={styles.sectionTitle}>
                {t('skillStudio.sectionBasic', { defaultValue: 'Basic Information' })}
              </h3>

              <div className={styles.formGroup}>
                <label className={styles.label}>
                  {t('skillStudio.fieldName', { defaultValue: 'Skill Name' })}
                </label>
                <Input
                  placeholder={t('skillStudio.placeholderName', { defaultValue: 'e.g. My Awesome Skill' })}
                  value={meta.name}
                  onChange={handleNameChange}
                  className={styles.input}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>
                  {t('skillStudio.fieldDescription', { defaultValue: 'Description' })}
                </label>
                <TextArea
                  placeholder={t('skillStudio.placeholderDescription', {
                    defaultValue: 'Brief description of what this skill does...',
                  })}
                  value={meta.description}
                  onChange={handleDescriptionChange}
                  className={styles.textarea}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>
                  {t('skillStudio.fieldTriggers', { defaultValue: 'Triggers' })}
                </label>
                <p className={styles.hint}>
                  {t('skillStudio.hintTriggers', {
                    defaultValue: 'Keywords or phrases that will activate this skill',
                  })}
                </p>

                <div className={styles.triggersContainer}>
                  <div className={styles.triggerTags}>
                    {meta.triggers.map((trigger, index) => (
                      <Tag
                        key={index}
                        closable
                        onClose={() => handleRemoveTrigger(index)}
                        className={styles.triggerTag}
                      >
                        {trigger}
                      </Tag>
                    ))}
                    {meta.triggers.length === 0 && (
                      <span className={styles.noTriggers}>
                        {t('skillStudio.noTriggers', { defaultValue: 'No triggers added' })}
                      </span>
                    )}
                  </div>

                  <div className={styles.triggerInput}>
                    <Input
                      placeholder={t('skillStudio.placeholderTrigger', { defaultValue: 'Add a trigger...' })}
                      value={newTrigger}
                      onChange={(v) => setNewTrigger(v)}
                      onPressEnter={handleTriggerKeyDown}
                      className={styles.triggerInputField}
                    />
                    <Button
                      type='secondary'
                      size='small'
                      onClick={() => void handleAddTrigger()}
                      icon={<Plus theme='outline' size={12} />}
                    >
                      {t('skillStudio.add', { defaultValue: 'Add' })}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Content Section */}
            <div className={styles.formSection}>
              <div className={styles.contentHeader}>
                <h3 className={styles.sectionTitle}>
                  {t('skillStudio.sectionContent', { defaultValue: 'Skill Content' })}
                </h3>
                <div className={styles.viewModeToggle}>
                  <Button
                    size='small'
                    type={viewMode === 'edit' ? 'primary' : 'secondary'}
                    onClick={() => setViewMode('edit')}
                  >
                    {t('skillStudio.edit', { defaultValue: 'Edit' })}
                  </Button>
                  <Button
                    size='small'
                    type={viewMode === 'split' ? 'primary' : 'secondary'}
                    onClick={() => setViewMode('split')}
                  >
                    {t('skillStudio.split', { defaultValue: 'Split' })}
                  </Button>
                  <Button
                    size='small'
                    type={viewMode === 'preview' ? 'primary' : 'secondary'}
                    onClick={() => setViewMode('preview')}
                  >
                    {t('skillStudio.preview', { defaultValue: 'Preview' })}
                  </Button>
                </div>
              </div>

              <div className={`${styles.contentEditor} ${styles[`viewMode-${viewMode}`]}`}>
                {viewMode !== 'preview' && (
                  <div className={styles.editorPane}>
                    <TextArea
                      placeholder={t('skillStudio.placeholderContent', {
                        defaultValue: 'Write your skill content in Markdown...',
                      })}
                      value={content}
                      onChange={handleContentChange}
                      className={styles.contentTextarea}
                      autoSize={{ minRows: viewMode === 'split' ? 12 : 20, maxRows: 40 }}
                    />
                  </div>
                )}
                {viewMode !== 'edit' && (
                  <div className={styles.previewPane}>
                    <div className={styles.previewLabel}>
                      {t('skillStudio.previewLabel', { defaultValue: 'Preview' })}
                    </div>
                    <div className={styles.previewContent}>
                      <MarkdownView allowHtml>{previewMarkdown}</MarkdownView>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

SkillForm.displayName = 'SkillForm';

export default SkillForm;
