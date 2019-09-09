'use strict'

const { Adapter } = require('interface-transport')
const withIs = require('class-is')
const TCP = require('.')

// Legacy adapter to old transport & connection interface
class TcpAdapter extends Adapter {
  constructor (config) {
    super(new TCP(config))
  }
}

module.exports = withIs(TcpAdapter, {
  className: 'TCP',
  symbolName: '@libp2p/js-libp2p-tcp/tcp'
})
