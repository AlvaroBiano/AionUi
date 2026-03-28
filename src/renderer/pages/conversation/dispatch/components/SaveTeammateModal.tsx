/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Form, Input, Message, Modal } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SaveTeammateModalProps } from '../types';

const FormItem = Form.Item;

const SaveTeammateModal: React.FC<SaveTeammateModalProps> = ({
  visible,
  childSessionId,
  initialName,
  initialAvatar,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  // Fetch full teammate config (including presetRules) when modal opens
  useEffect(() => {
    if (!visible) return;

    setFetching(true);
    ipcBridge.dispatch.getTeammateConfig
      .invoke({ childSessionId })
      .then((res) => {
        if (res.success && res.data) {
          form.setFieldsValue({
            name: res.data.name || initialName || '',
            avatar: res.data.avatar || initialAvatar || '',
            presetRules: res.data.presetRules || '',
          });
        } else {
          // Fall back to initial values
          form.setFieldsValue({
            name: initialName || '',
            avatar: initialAvatar || '',
            presetRules: '',
          });
        }
      })
      .catch(() => {
        form.setFieldsValue({
          name: initialName || '',
          avatar: initialAvatar || '',
          presetRules: '',
        });
      })
      .finally(() => {
        setFetching(false);
      });
  }, [visible, childSessionId, initialName, initialAvatar, form]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validate();
      if (!values.name?.trim()) return;

      setLoading(true);
      const result = await ipcBridge.dispatch.saveTeammate.invoke({
        name: values.name.trim(),
        avatar: values.avatar?.trim() || undefined,
        presetRules: values.presetRules?.trim() || undefined,
      });

      if (result.success && result.data) {
        Message.success(t('dispatch.teammate.saveSuccess'));
        onSaved(result.data.assistantId);
        onClose();
      } else if (result.msg?.includes('already exists')) {
        Message.error(t('dispatch.teammate.saveDuplicate'));
      } else {
        Message.error(t('dispatch.teammate.saveError'));
      }
    } catch (err) {
      if (err instanceof Error) {
        Message.error(t('dispatch.teammate.saveError'));
      }
    } finally {
      setLoading(false);
    }
  }, [form, onSaved, onClose, t]);

  const handleClose = useCallback(() => {
    form.resetFields();
    onClose();
  }, [form, onClose]);

  return (
    <Modal
      title={t('dispatch.teammate.saveTitle')}
      visible={visible}
      onCancel={handleClose}
      autoFocus={false}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button onClick={handleClose}>{t('dispatch.teammate.cancel')}</Button>
          <Button type='primary' loading={loading || fetching} onClick={handleSave}>
            {t('dispatch.teammate.saveConfirm')}
          </Button>
        </div>
      }
    >
      <Form form={form} layout='vertical' disabled={fetching}>
        <FormItem
          label={t('dispatch.teammate.nameLabel')}
          field='name'
          rules={[{ required: true, message: t('dispatch.teammate.nameRequired') }]}
        >
          <Input placeholder={t('dispatch.teammate.namePlaceholder')} maxLength={100} />
        </FormItem>
        <FormItem label={t('dispatch.teammate.avatarLabel')} field='avatar'>
          <Input placeholder={t('dispatch.teammate.avatarPlaceholder')} maxLength={2} style={{ width: '80px' }} />
        </FormItem>
        <FormItem label={t('dispatch.teammate.promptLabel')} field='presetRules'>
          <Input.TextArea
            placeholder={t('dispatch.teammate.promptPlaceholder')}
            maxLength={4000}
            showWordLimit
            autoSize={{ minRows: 4, maxRows: 10 }}
          />
        </FormItem>
      </Form>
    </Modal>
  );
};

export default SaveTeammateModal;
