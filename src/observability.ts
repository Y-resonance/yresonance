import { platform } from '#/platform/index.server';

export function recordProductMetric(
  event: string,
  values: {
    labels?: string[];
    numbers?: number[];
    index?: string;
  } = {},
) {
  platform.productAnalytics?.writeDataPoint({
    blobs: [event, ...(values.labels ?? [])],
    doubles: values.numbers,
    indexes: values.index ? [values.index] : undefined,
  });
}
