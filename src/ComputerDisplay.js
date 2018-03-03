import React, { Component } from 'react';
import jenkins from './Jenkins.js';
import AsOf from './AsOf.js';

// Last updated 2018-03-01
const centsPerHour = {
  'linux-cpu': 17, // c5.xlarge
  'linux-gpu': 228, // g3.8xlarge
  'linux-cpu-ccache': 17, // c5.xlarge
  'win-cpu': 34, // c5.2xlarge
  'win-gpu': 114, // g3.4xlarge
  'osx': 13900/30/24, // MacStadium mini i7 250 elite
  'master': 17, // c5.xlarge
};

export default class ComputerDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = { computer: [], currentTime: new Date(), updateTime: new Date(0) };
  }
  componentDidMount() {
    this.update();
    this.interval = setInterval(this.update.bind(this), this.props.interval);
  }
  componentWillUnmount() {
    clearInterval(this.interval);
  }
  async update() {
    this.setState({currentTime: new Date()});
    const data = await jenkins.computer();
    data.updateTime = new Date();
    this.setState(data);
  }
  render() {
    function classify_node(node) {
      if (/^c5.xlarge-i-.*$/.test(node)) {
        return 'linux-cpu';
      }
      if (/^g3.8xlarge-i-.*$/.test(node)) {
        return 'linux-gpu';
      }
      if (/^worker-c5-xlarge-.*$/.test(node)) {
        return 'linux-cpu-ccache';
      }
      if (/^worker-macos-high-sierra-.*$/.test(node)) {
        return 'osx';
      }
      if (/^worker-win-c5.2xlarge-i-.*$/.test(node)) {
        return 'win-cpu';
      }
      if (/^worker-win-g3.4xlarge-i-.*$/.test(node)) {
        return 'win-gpu';
      }
      if (/^worker-osuosl-ppc64le-cpu-.*$/.test(node)) {
        return 'ppc';
      }
      return node;
    }

    const map = new Map();
    this.state.computer.forEach((c) => {
      const k = classify_node(c.displayName);
      let v = map.get(k);
      if (v === undefined) v = { busy: 0, total: 0 };
      if (!c.offline) {
        v.total++;
        if (!c.idle) v.busy++;
      }
      map.set(k, v);
    });

    let totalCost = 0;
    map.forEach((v, k) => {
      const perCost = centsPerHour[k];
      if (perCost !== undefined) {
        v.totalCost = perCost * v.total;
        totalCost += v.totalCost;
      }
    });

    function centsToDollars(x) {
      if (x === undefined) return "?";
      // I feel a little dirty resorting to floating point math
      // here...
      return (x / 100).toLocaleString("en-US", {style: "currency", currency: "USD"});
    }

    const rows = [...map.entries()].sort().map(kv => {
      const cost = centsToDollars(kv[1].totalCost);
      return (<tr key={kv[0]}>
          <th>{kv[0]}</th>
          <td>{kv[1].busy} / {kv[1].total}</td>
          <td className="ralign">{cost}/hr</td>
        </tr>);
    });
    return (
      <div>
        <h2>Computers <AsOf interval={this.props.interval} currentTime={this.state.currentTime} updateTime={this.state.updateTime} /></h2>
        <table>
          <tbody>{rows}</tbody>
          <tfoot>
            <tr><td></td><td className="ralign" colSpan="2">{centsToDollars(totalCost*24*30)}/mo</td></tr>
          </tfoot>
        </table>
      </div>
      );
  }
}

