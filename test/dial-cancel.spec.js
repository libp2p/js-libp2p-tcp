/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const TCP = require('../src')
const net = require('net')
const AbortController = require('abort-controller')
const multiaddr = require('multiaddr')
const pipe = require('it-pipe')
const sinon = require('sinon')

describe('dial cancel', () => {
  let tcp
  let listener
  const ma = multiaddr('/ip4/127.0.0.1/tcp/9090')

  beforeEach(() => {
    tcp = new TCP()
    listener = tcp.createListener((conn) => pipe(conn, conn))
    return listener.listen(ma)
  })

  afterEach(() => listener.close())

  it('cancel before dialing', async () => {
    const controller = new AbortController()
    controller.abort()
    const socket = tcp.dial(ma, { signal: controller.signal })

    try {
      await socket
    } catch (err) {
      expect(err.code).to.eql('ABORT_ERR')
      return
    }
    expect.fail('Did not throw error')
  })

  it('cancel while dialing', async () => {
    // Add a delay to net.connect() so that we can cancel while the dial is in
    // progress
    const netConnect = net.connect
    sinon.replace(net, 'connect', (opts) => {
      const socket = netConnect(opts)
      const socketEmit = socket.emit.bind(socket)
      sinon.replace(socket, 'emit', (...args) => {
        const delay = args[0] === 'connect' ? 100 : 0
        // eslint-disable-next-line max-nested-callbacks
        setTimeout(() => socketEmit(...args), delay)
      })
      return socket
    })

    const controller = new AbortController()
    const socket = tcp.dial(ma, { signal: controller.signal })
    setTimeout(() => {
      controller.abort()
    }, 10)

    try {
      await socket
    } catch (err) {
      expect(err.code).to.eql('ABORT_ERR')
      return
    } finally {
      sinon.restore()
    }
    expect.fail('Did not throw error')
  })
})
