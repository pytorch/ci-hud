import React, { Component, Fragment } from 'react';
import jenkins from './Jenkins.js';
import AsOf from './AsOf.js';
import { summarize_job } from './Summarize.js';

export default class BuildHistoryDisplay extends Component {
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
      <th className="rotate" key={jobName}><div><span>{summarize_job(jobName)}</span></div></th>
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
            <tr>
              <th></th>
              {known_jobs_head}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }
}

