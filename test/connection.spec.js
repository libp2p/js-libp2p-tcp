/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const TCP = require('../src')
const multiaddr = require('multiaddr')

describe('valid Connection', () => {
  let tcp

  beforeEach(() => {
    tcp = new TCP()
  })

  const ma = multiaddr('/ip4/127.0.0.1/tcp/9090')

  it('get observed addrs', async () => {
    // Create a Promise that resolves when a connection is handled
    let handled
    const handlerPromise = new Promise((resolve) => {
      handled = resolve
    })

    const handler = async (conn) => {
      expect(conn).to.exist()
      const dialerObsAddrs = await conn.getObservedAddrs()
      handled(dialerObsAddrs)
    }

    // Create a listener with the handler
    const listener = tcp.createListener(handler)

    // Listen on the multi-address
    await listener.listen(ma)

    // Dial to that same address
    const conn = await tcp.dial(ma)
    const addrs = await conn.getObservedAddrs()

    // Wait for the incoming dial to be handled
    const dialerObsAddrs = await handlerPromise

    // Close the listener
    await listener.close()

    // The addresses should match
    expect(addrs.length).to.equal(1)
    expect(addrs[0]).to.deep.equal(ma)
    expect(dialerObsAddrs.length).to.equal(1)
    expect(dialerObsAddrs[0]).to.exist()
  })
})
