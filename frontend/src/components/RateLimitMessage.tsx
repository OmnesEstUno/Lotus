import { useEffect, useMemo, useState } from 'react';

interface Props {
  message: string;
}

const RATE_LIMIT_PATTERN = /Try again in (\d+)\s+(second|minute)\(s\)\.?/i;

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return '0 seconds';
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (rem === 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${minutes} min ${rem} sec`;
}

/**
 * Renders an error message verbatim, with one exception: if the message
 * matches "Try again in N second(s)" (or minute(s)), the count is replaced
 * with a live countdown that ticks every second. Once the countdown hits
 * zero the text becomes "You can try again now."
 *
 * Falls through to plain text rendering for messages that don't match the
 * pattern.
 */
export default function RateLimitMessage({ message }: Props) {
  // Capture the unlock target as an absolute timestamp the moment the
  // message arrives, so the countdown isn't affected by render scheduling
  // or timer drift.
  const endTime = useMemo(() => {
    const match = message.match(RATE_LIMIT_PATTERN);
    if (!match) return null;
    const total = match[2].toLowerCase() === 'minute'
      ? parseInt(match[1], 10) * 60
      : parseInt(match[1], 10);
    return Date.now() + total * 1000;
  }, [message]);

  // Tick every second while the timer is live.
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (endTime === null) return;
    if (Date.now() >= endTime) return;
    const interval = window.setInterval(() => {
      forceRender((n) => n + 1);
      if (Date.now() >= endTime) window.clearInterval(interval);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [endTime]);

  if (endTime === null) return <>{message}</>;

  const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  const replacement = remaining > 0
    ? `Try again in ${formatSeconds(remaining)}.`
    : 'You can try again now.';
  return <>{message.replace(RATE_LIMIT_PATTERN, replacement)}</>;
}
