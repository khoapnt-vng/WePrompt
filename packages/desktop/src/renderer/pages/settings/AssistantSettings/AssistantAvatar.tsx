/**
 * AssistantAvatar — Renders an assistant's avatar with emoji, image, or fallback icon.
 */
import type { AssistantListItem } from './types';
import { Avatar } from '@arco-design/web-react';
import { Robot } from '@icon-park/react';
import React from 'react';
import { isEmoji, resolveAvatarImageSrc } from './assistantUtils';

type AssistantAvatarProps = {
  assistant: AssistantListItem;
  size?: number;
};

const AssistantAvatar: React.FC<AssistantAvatarProps> = ({ assistant, size = 32 }) => {
  const resolvedAvatar = assistant.avatar?.trim();
  const hasEmojiAvatar = Boolean(resolvedAvatar && isEmoji(resolvedAvatar));
  const avatarImage = resolveAvatarImageSrc(resolvedAvatar);
  const iconSize = Math.floor(size * 0.5);
  const emojiSize = Math.floor(size * 0.6);

  // A resolved src can still fail to load (e.g. a bundled extension asset
  // missing from this build, or a bare filename that never resolves). Fall
  // back to the emoji/icon instead of the browser's broken-image glyph. Reset
  // on src change so a different assistant re-attempts the load.
  const [imageFailed, setImageFailed] = React.useState(false);
  React.useEffect(() => {
    setImageFailed(false);
  }, [avatarImage]);
  const showImage = Boolean(avatarImage) && !imageFailed;

  return (
    <Avatar.Group size={size}>
      <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
        {showImage ? (
          <img
            src={avatarImage}
            alt=''
            className='h-full w-full rounded-inherit object-cover'
            style={{ display: 'block' }}
            onError={() => setImageFailed(true)}
          />
        ) : hasEmojiAvatar ? (
          <span style={{ fontSize: emojiSize }}>{resolvedAvatar}</span>
        ) : (
          <Robot theme='outline' size={iconSize} />
        )}
      </Avatar>
    </Avatar.Group>
  );
};

export default AssistantAvatar;
