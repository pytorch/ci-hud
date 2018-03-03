import React, { Component, Fragment } from 'react';
import './App.css';
import axios from 'axios';

class Jenkins {
  url(s) {
    return "https://ci.pytorch.org/jenkins/" + s + "/api/json";
  }
  link(s) {
    return "https://ci.pytorch.org/jenkins/" + s;
  }

  async get(url, options) {
    if (options === undefined) options = {};
    const r = await axios.get(url, { params: options });
    // TODO: check status
    return r.data;
  }

  async computer(options) { return this.get(this.url("computer"), options); }
  async queue(options) { return this.get(this.url("queue"), options); }
  async job(v, options) { return this.get(this.url("job/" + v), options); }
}
const jenkins = new Jenkins();

function AsOf(props) {
  const updateStatus = props.currentTime - props.updateTime > props.interval ? 'disconnected' : 'connected';
  const timeString = props.updateTime - new Date(0) === 0 ?
                     <Fragment>pending</Fragment> :
                     <Fragment>
                      as of {props.updateTime.toLocaleTimeString()}; {updateStatus}
                     </Fragment>;
  return <span className={updateStatus}>({timeString})</span>
}

class ComputerDisplay extends Component {
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

function summarize_job(job) {
  return job.replace(/^pytorch-/, '').replace(/-trigger$/, '');
}

class QueueDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = { items: [], currentTime: new Date(), updateTime: new Date(0) };
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
    const data = await jenkins.queue();
    data.updateTime = new Date();
    this.setState(data);
  }
  render() {
    function summarize_project(project) {
      return project.replace(/-builds$/, '');
    }

    function summarize_url(url) {
      let m;
      if ((m = RegExp('^https://ci\\.pytorch\\.org/jenkins/job/([^/]+)/job/([^/]+)/$').exec(url)) !== null) {
        return summarize_project(m[1]) + "/" + summarize_job(m[2]);
      }
      if ((m = RegExp('https://ci\\.pytorch\\.org/jenkins/job/([^/]+)/').exec(url)) !== null) {
        return m[1];
      }
      return url;
    }

    function summarize_why(why) {
      return why.replace(/^Waiting for next available executor on/, 'Needs')
                .replace(/docker&&cpu&&ccache/, 'linux-cpu-ccache')
                .replace(/docker&&cpu/, 'linux-cpu')
                .replace(/docker&&gpu/, 'linux-gpu')
                .replace(/windows&&cpu/, 'windows-cpu')
                .replace(/windows&&gpu/, 'windows-gpu')
                .replace(/g3.8xlarge-i-[^ ]+/, 'linux-gpu')
                .replace(/worker-win-c5.2xlarge-i-[^ ]+/, 'windows-cpu')
                .replace(/worker-win-g3.4xlarge-i-[^ ]+/, 'windows-gpu')
    }

    const task_map = new Map();
    this.state.items.forEach((q) => {
      const task = summarize_url(q.task.url);
      const why = summarize_why(q.why);
      let why_map = task_map.get(task);
      if (why_map === undefined) {
        why_map = new Map();
        task_map.set(task, why_map);
      }
      let v = why_map.get(why);
      if (v === undefined) {
        v = { total: 0 };
        why_map.set(why, v);
      }
      v.total++;
    });

    const rows = [...task_map.entries()].sort().map((task_why_map) => {
      const task = task_why_map[0];
      const why_map = task_why_map[1];
      const rows = [...why_map.entries()].sort().map(why_v => {
        const why = why_v[0];
        const v = why_v[1];
        return <tr key={why}><th>{task}</th><td>{v.total}</td><td>{why}</td></tr>
      });
      return <Fragment key={task}>{rows}</Fragment>
    });
    return (
      <div>
        <h2>Queue <AsOf interval={this.props.interval} currentTime={this.state.currentTime} updateTime={this.state.updateTime} /></h2>
        <table>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }
}

class BuildHistoryDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = { builds: [], currentTime: new Date(), updateTime: new Date(0) };
  }
  componentDidMount() {
    this.update();
    this.interval = setInterval(this.update.bind(this), this.props.interval);
  }
  async update() {
    this.setState({currentTime: new Date()});
    const data = await jenkins.job(this.props.job, {depth: 1});
    data.updateTime = new Date();
    this.setState(data);
  }
  render() {
    function result_icon(result) {
      if (result === 'SUCCESS') return '✅';
      if (result === 'FAILURE') return '❌';
      if (result === 'ABORTED') return '⭕';
      if (!result) return '❓';
      return result;
    }

    // TODO: do the slice server side
    const builds = this.state.builds.slice(0, 10);

    const known_jobs_set = new Set();
    builds.forEach((b) => {
      b.subBuilds.forEach((sb) => {
        known_jobs_set.add(sb.jobName);
      });
    });
    // NB: use insertion order
    const known_jobs = [...known_jobs_set.values()];

    const known_jobs_head = known_jobs.map((jobName) =>
      <th class="rotate"><div><span>{summarize_job(jobName)}</span></div></th>
    );

    const rows = builds.map((b) => {
      const sb_map = new Map();
      b.subBuilds.forEach(sb => {
        sb_map.set(sb.jobName, sb);
      });

      const cols = known_jobs.map((jobName) => {
        const sb = sb_map.get(jobName);
        let cell = <Fragment />;
        if (sb !== undefined) {
          cell = <a href={jenkins.link(sb.url)} className="icon" target="_blank" alt={sb.jobName}>{result_icon(sb.result)}</a>;
        }
        return <td key={jobName}>{cell}</td>;
      });

      return (
        <tr key={b.number}>
          <th><a href={b.url} target="_blank">{b.number}</a></th>
          {cols}
          <td></td>
        </tr>
        );
    });

    return (
      <div>
        <h2>{this.props.job} history <AsOf interval={this.props.interval} currenttime={this.state.currentTime} updateTime={this.state.updateTime} /></h2>
        <table>
          <thead>
            <th></th>
            {known_jobs_head}
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }
}

class App extends Component {

  render() {
    return (
      <div className="App">
        <header className="App-header">
          <h1 className="App-title">ci.pytorch.org HUD</h1>
        </header>
        <BuildHistoryDisplay interval={60000} job="pytorch-master" />
        <QueueDisplay interval={1000} />
        <ComputerDisplay interval={1000} />
      </div>
    );
  }
}

export default App;
