/* eslint-disable etc/prefer-interface, @typescript-eslint/method-signature-style */

type LabelsGeneric = Record<string, string | undefined>
type CollectFn<Labels extends LabelsGeneric> = (metric: Gauge<Labels>) => void

interface Gauge<Labels extends LabelsGeneric = never> {
  // Sorry for this mess, `prom-client` API choices are not great
  // If the function signature was `inc(value: number, labels?: Labels)`, this would be simpler
  inc(value?: number): void
  inc(labels: Labels, value?: number): void
  inc(arg1?: Labels | number, arg2?: number): void

  dec(value?: number): void
  dec(labels: Labels, value?: number): void
  dec(arg1?: Labels | number, arg2?: number): void

  set(value: number): void
  set(labels: Labels, value: number): void
  set(arg1?: Labels | number, arg2?: number): void

  addCollect(collectFn: CollectFn<Labels>): void
}

export enum ServerStatusMetric {
  stopped = 0,
  started = 1
}

export interface TcpMetrics {
  serverStatus: Gauge
  connections: Gauge
  listenerErrors: Gauge<{error: string}>
  socketEvents: Gauge<{event: string}>
}
