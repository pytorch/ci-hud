import React, { Component, Fragment } from 'react';
import AsOf from './AsOf.js';
import { summarize_job, summarize_date } from './Summarize.js';
import Tooltip from 'rc-tooltip';
import axios from 'axios';

function is_success(result) {
  return result === 'SUCCESS' || result === 'success';
}

function is_failure(result) {
  // TODO: maybe classify timeout differently
  return result === 'FAILURE' || result === 'failure' || result === 'error' || result === 'timed_out';
}

function is_aborted(result) {
  return result === 'ABORTED' || result == 'cancelled';
}

function is_pending(result) {
  return !result || result === 'pending';
}

export default class BuildHistoryDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = this.initialState();
  }
  initialState() {
    const prefs_str = localStorage.getItem("prefs2");
    let prefs = {};
    if (prefs_str) {
      prefs = JSON.parse(prefs_str);
    }
    if (!("showNotifications" in prefs)) prefs["showNotifications"] = true;
    return {
      builds: [],
      known_jobs: [],
      currentTime: new Date(),
      updateTime: new Date(0),
      showNotifications: prefs.showNotifications
    };
  }
  componentDidMount() {
    this.update();
    this.interval = setInterval(this.update.bind(this), this.props.interval);
    if (this.state.showNotifications && Notification.permission !== "granted") {
      Notification.requestPermission();
    }
  }
  componentDidUpdate(prevProps) {
    localStorage.setItem("prefs2", JSON.stringify({
      showNotifications: this.state.showNotifications,
    }));
    if (this.props.job !== prevProps.job) {
      this.setState(this.initialState());
      this.update();
    }
  }
  async update() {
    const currentTime = new Date();
    this.setState({currentTime: currentTime});

    const commits = await axios.get("https://s3.amazonaws.com/ossci-job-status/master/index.json");

    const requests = commits.data.map(async build => {
      try {
        const r = await axios.get("https://s3.amazonaws.com/ossci-job-status/master/" + build.id + ".json")
        build.sb_map = r.data;
      } catch (e) {
        build.sb_map = {};
        // swallow
      }
      return build;
    })
    const builds = await axios.all(requests)

    const data = {}

    data.updateTime = new Date();
    data.connectedIn = data.updateTime - currentTime;

    const known_jobs_set = new Set();
    builds.forEach(build => {
      Object.keys(build.sb_map).forEach(job_name => {
        known_jobs_set.add(job_name);
      });
    });
 
    data.known_jobs = [...known_jobs_set.values()].sort();
    data.builds = builds;

    // TODO
    data.consecutive_failure_count = new Map();

    // TODO: This can cause spurious state updates
    this.setState(data);
  }

  render() {
    function result_icon(result) {
      if (is_success(result)) return <span role="img" style={{color:"green"}} aria-label="passed">0</span>;
      if (is_failure(result)) return <span role="img" style={{color:"red"}} aria-label="failed">X</span>;
      if (is_aborted(result)) return <span role="img" style={{color:"gray"}} aria-label="cancelled">.</span>;
      if (is_pending(result)) return <span className="animate-flicker" role="img" style={{color:"goldenrod"}} aria-label="in progress">?</span>;
      return result;
    }

    let builds = this.state.builds;
    let consecutive_failure_count = this.state.consecutive_failure_count;

    const known_jobs = this.state.known_jobs;
    const known_jobs_head = known_jobs.map((jobName) =>
      <th className="rotate" key={jobName}><div className={consecutive_failure_count.has(jobName) ? "failing-header" : ""}>{summarize_job(jobName)}</div></th>
    );

    const seen_prs = new Set();

    const rows = builds.map((build) => {
      let found = false;
      const sb_map = build.sb_map;

      const status_cols = known_jobs.map((jobName) => {
        const sb = sb_map[jobName];
        let cell = <Fragment />;
        if (sb !== undefined) {
          found = true;
          cell = <a href={sb.build_url}
                    className="icon"
                    target="_blank"
                    alt={jobName}>
                   {result_icon(sb.result)}
                 </a>;
        }
        return <Tooltip
                      key={jobName}
                      overlay={jobName}
                      mouseLeaveDelay={0}
                      placement="rightTop"
                      destroyTooltipOnHide={true}><td key={jobName} className="icon-cell" style={{textAlign: "right", fontFamily: "sans-serif", padding: 0}}>{cell}</td></Tooltip>;
      });

      function drop_pr_number(msg) {
        return msg.replace(/\(#[0-9]+\)/, '');
      }

      function renderPullRequestNumber(comment) {
        let m = comment.match(/\(#(\d+)\)/);
        if (m) {
          return <Fragment><a href={"https://github.com/pytorch/pytorch/pull/" + m[1]} target="_blank">#{m[1]}</a></Fragment>;
        }
        return <Fragment />;
      }

      let author = "";
      let pull_link;
      let pull_id;

      const desc =
          <div key={build.id}>
            <code><a href={"https://github.com/pytorch/pytorch/commit/" + build.id}
                     target="_blank">{build.id.slice(0, 7)}</a></code>
          </div>;

      // TODO: Too lazy to set up PR numbers for the old ones

      let stale = false;

      // TODO: need to store this in index or payload
      // const whenString = summarize_date(build.timestamp);
      const whenString = "WHEN";

      if (!found) {
        return <Fragment key={build.id} />
      }

      return (
        <tr key={build.id} className={stale ? "stale" : ""}>
          <th className="left-cell">PR</th>
          <td className="left-cell">{whenString}</td>
          {status_cols}
          <td className="right-cell">{author}</td>
          <td className="right-cell">{desc}</td>
        </tr>
        );
    });

    return (
      <div>
        <h2>
          {this.props.job} history{' '}
          <AsOf interval={this.props.interval}
                connectedIn={this.state.connectedIn}
                currentTime={this.state.currentTime}
                updateTime={this.state.updateTime} />
        </h2>
        <div>
          <ul className="menu">
            <li>
              <input type="checkbox" name="show-notifications" checked={this.state.showNotifications} onChange={(e) => this.setState({showNotifications: e.target.checked}) } />
              <label htmlFor="show-notifications">Show notifications on master failure
                { Notification.permission === "denied" ? <Fragment> <strong>(WARNING: notifications are currently denied)</strong></Fragment> : "" }
              </label>
            </li>
          </ul>
        </div>
        <table className="buildHistoryTable">
          <thead>
            <tr>
              <th className="left-cell">PR#</th>
              <th className="left-cell">Date</th>
              {known_jobs_head}
              <th className="right-cell">User</th>
              <th className="right-cell">Description</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }

}
