export enum ServerStatusMetric {
  stopped = 0,
  started = 1
}

export function getMetrics (register: MetricsRegister) {
  return {
    serverStatus: register.gauge({
      name: 'libp2p_tcp_server_status',
      help: 'Current status of the TCP server'
    }),

    connections: register.gauge({
      name: 'libp2p_tcp_connections_count',
      help: 'Current active connections in TCP listener'
    }),

    listenerErrors: register.gauge<{ error: string }>({
      name: 'libp2p_tcp_listener_errors_total',
      help: 'Total count of TCP listener errors by error type',
      labelNames: ['error']
    }),

    socketEvents: register.gauge<{ event: string }>({
      name: 'libp2p_tcp_socket_events',
      help: 'Total count of TCP socket events by event',
      labelNames: ['event']
    })
  }
}

export type Metrics = ReturnType<typeof getMetrics>

/* eslint-disable etc/prefer-interface, @typescript-eslint/method-signature-style */

export interface MetricsRegister {
  gauge<T extends LabelsGeneric>(config: GaugeConfig<T>): Gauge<T>
}

interface GaugeConfig<Labels extends LabelsGeneric> {
  name: string
  help: string
  labelNames?: keyof Labels extends string ? Array<keyof Labels> : undefined
}

type LabelsGeneric = Record<string, string | undefined>
type CollectFn<Labels extends LabelsGeneric> = (metric: Gauge<Labels>) => void

interface Gauge<Labels extends LabelsGeneric = never> {
  // Follows `prom-client` API choices, to require less middleware on consumer
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
