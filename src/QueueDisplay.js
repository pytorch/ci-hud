import React, { Component, Fragment } from 'react';
import jenkins from './Jenkins.js';
import AsOf from './AsOf.js';
import { summarize_job } from './Summarize.js';

export default class QueueDisplay extends Component {
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

