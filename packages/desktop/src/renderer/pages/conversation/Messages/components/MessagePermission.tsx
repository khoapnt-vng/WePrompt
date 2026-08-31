/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessagePermission } from '@/common/chat/chatLib';
import { ipcBridge } from '@/common';
import { iconColors } from '@/renderer/styles/colors';
import { Button, Card, Message, Typography } from '@arco-design/web-react';
import { Api, Attention, Bookmark, CheckOne, Edit, Lightning, Lock } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { summarizePermission } from './permissionIntent';

const { Text } = Typography;

interface MessagePermissionProps {
  message: IMessagePermission;
}

const ICON_SIZE = '18';

const actionIcons: Record<string, React.ReactNode> = {
  exec: <Lightning theme='outline' size={ICON_SIZE} fill={iconColors.secondary} data-testid='permission-icon-exec' />,
  edit: <Edit theme='outline' size={ICON_SIZE} fill={iconColors.secondary} data-testid='permission-icon-edit' />,
  info: <Bookmark theme='outline' size={ICON_SIZE} fill={iconColors.secondary} data-testid='permission-icon-info' />,
  mcp: <Api theme='outline' size={ICON_SIZE} fill={iconColors.secondary} data-testid='permission-icon-mcp' />,
};

const MessagePermission: React.FC<MessagePermissionProps> = React.memo(({ message }) => {
  const { t } = useTranslation();
  const { options = [], description, title, action, call_id, command_type } = message.content || {};

  // Which option is in flight, rather than a bare boolean: the pressed button gets Arco's
  // spinner while its siblings only grey out, so a slow confirm shows WHICH answer is pending.
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [hasResponded, setHasResponded] = useState(false);

  const summary = summarizePermission({ action, command: description, commandType: command_type });
  const icon = summary.destructive ? (
    <Attention theme='outline' size={ICON_SIZE} fill={iconColors.danger} data-testid='permission-icon-destructive' />
  ) : (
    actionIcons[action || ''] || (
      <Lock theme='outline' size={ICON_SIZE} fill={iconColors.secondary} data-testid='permission-icon-generic' />
    )
  );
  const displayTitle =
    summary.intentKey === 'messages.permission.intent.generic' ? title || t(summary.intentKey) : t(summary.intentKey);
  const handleConfirm = async (selected: string) => {
    if (hasResponded || pendingValue !== null) return;

    setPendingValue(selected);
    try {
      const always_allow = selected === 'proceed_always';
      await ipcBridge.conversation.confirmation.confirm.invoke({
        conversation_id: message.conversation_id,
        call_id,
        msg_id: message.msg_id || '',
        data: { value: selected },
        always_allow,
      });
      setHasResponded(true);
    } catch (error) {
      // Without a toast the card silently snapped back to un-answered while the agent stayed
      // blocked forever, so surface it and leave the options clickable for a retry.
      Message.error(t('messages.permissionResponseFailed'));
      console.error('Error confirming permission:', error);
    } finally {
      setPendingValue(null);
    }
  };

  return (
    <Card className='mb-4' bordered={false} style={{ background: 'var(--bg-1)' }} data-testid='message-permission-card'>
      <div className='space-y-4'>
        <div className='flex items-center space-x-2'>
          <span className='flex-shrink-0 flex items-center'>{icon}</span>
          <Text className='block'>{displayTitle}</Text>
        </div>
        {summary.destructive && (
          <div>
            <Text className='text-13px text-danger'>{t('messages.permission.destructiveWarning')}</Text>
          </div>
        )}
        {summary.command && (
          <div className='rd-6px p-x-10px p-y-8px' style={{ background: 'var(--bg-2)' }}>
            <Text className='font-mono text-12px text-t-secondary [word-break:break-all]'>{summary.command}</Text>
          </div>
        )}
        {!hasResponded && (
          <>
            <div className='mt-10px'>{t('messages.chooseAction')}</div>
            {options.length > 0 ? (
              <div className='flex flex-wrap gap-8px'>
                {options.map((option, index) => {
                  const value = String(option.value);
                  const isDeny = /deny|reject|cancel|no/i.test(value);
                  // For destructive actions, don't let "always allow" look like a
                  // casual default — mute it so auto-approving deletes is deliberate.
                  const isAlwaysAllow = /always/i.test(value);
                  const deEmphasize = isDeny || (summary.destructive && isAlwaysAllow);
                  return (
                    <Button
                      key={value || `option_${index}`}
                      type={deEmphasize ? 'secondary' : 'primary'}
                      // Approving a delete is the highest-stakes confirm in the chat UI; it
                      // should not look like an ordinary primary action.
                      status={summary.destructive && !deEmphasize ? 'danger' : undefined}
                      size='small'
                      disabled={pendingValue !== null && pendingValue !== value}
                      loading={pendingValue === value}
                      onClick={() => void handleConfirm(value)}
                      data-testid={`message-permission-option-${value || `option_${index}`}`}
                    >
                      {t(option.label, { ...option.params, defaultValue: option.label })}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <Text type='secondary'>{t('messages.noOptionsAvailable')}</Text>
            )}
          </>
        )}
        {hasResponded && (
          <div
            className='mt-10px p-2 rounded-md border'
            style={{ backgroundColor: 'var(--color-success-light-1)', borderColor: 'rgb(var(--success-3))' }}
          >
            <Text className='text-sm inline-flex items-center gap-6px' style={{ color: 'rgb(var(--success-6))' }}>
              <CheckOne theme='filled' size='14' fill={iconColors.success} data-testid='permission-icon-responded' />
              {t('messages.responseSentSuccessfully')}
            </Text>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessagePermission;
