import { describe, expect, it } from 'vitest';
import { analyticsUrl, sanitizeAnalyticsProperties } from './config';

describe('analytics URLs', () => {
  it('removes access tokens and auth parameters while keeping campaign attribution', () => {
    const value = analyticsUrl(
      'https://yresonance.com/share/private-access-token?token=secret&__clerk_ticket=credential&utm_source=newsletter#private-fragment',
    );
    expect(value).toBe('https://yresonance.com/share/[redacted]?utm_source=newsletter');
  });

  it('keeps normal dashboard paths and drops malformed URLs', () => {
    expect(analyticsUrl('https://yresonance.com/dashboards/dash_123')).toBe(
      'https://yresonance.com/dashboards/dash_123',
    );
    expect(analyticsUrl('not a URL')).toBeUndefined();
  });

  it('redacts nested first-touch properties and exception frame URLs', () => {
    const properties = sanitizeAnalyticsProperties({
      $set_once: { $initial_current_url: 'https://yresonance.com/share/secret?token=credential' },
      $exception_list: [
        { stacktrace: { frames: [{ filename: 'https://yresonance.com/share/secret' }] } },
      ],
      $title: 'Confidential client report',
      $pathname: '/share/secret',
    });
    expect(JSON.stringify(properties)).not.toMatch(/secret|credential|Confidential/);
    expect(properties.$pathname).toBe('/share/[redacted]');
  });
});
