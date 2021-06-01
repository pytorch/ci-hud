import React, { Component, Fragment } from 'react';
import AsOf from './AsOf.js';
import { summarize_job, summarize_date } from './Summarize.js';
import Tooltip from 'rc-tooltip';
import axios from 'axios';

const binary_and_smoke_tests_on_pr = [
  "binary_linux_manywheel_2_7mu_cpu_devtoolset7_build",
  "binary_linux_manywheel_3_7m_cu100_devtoolset7_build",
  "binary_linux_conda_2_7_cpu_devtoolset7_build",
  "binary_macos_wheel_3_6_cpu_build",
  "binary_macos_conda_2_7_cpu_build",
  "binary_macos_libtorch_2_7_cpu_build",
  "binary_linux_manywheel_2_7mu_cpu_devtoolset7_test",
  "binary_linux_manywheel_3_7m_cu100_devtoolset7_test",
  "binary_linux_conda_2_7_cpu_devtoolset7_test",
  "binary_linux_libtorch_2_7m_cpu_devtoolset7_shared-with-deps_build",
  "binary_linux_libtorch_2_7m_cpu_devtoolset7_shared-with-deps_test",
  "binary_linux_libtorch_2_7m_cpu_gcc5_4_cxx11-abi_shared-with-deps",
  "pytorch_linux_xenial_pynightly",
];

function nightly_run_on_pr(job_name) {
  return binary_and_smoke_tests_on_pr.some((n) => job_name.includes(n));
}

function is_success(result) {
  return result === 'SUCCESS' || result === 'success';
}

function is_failure(result) {
  // TODO: maybe classify timeout differently
  return result === 'FAILURE' || result === 'failure' || result === 'error' || result === 'timed_out';
}

function is_aborted(result) {
  return result === 'ABORTED' || result === 'cancelled';
}

function is_pending(result) {
  return !result || result === 'pending';
}

function is_skipped(result) {
  return result === 'skipped';
}

function is_infra_failure(result) {
  return result === 'infrastructure_fail';
}

function objToStrMap(obj) {
  let strMap = new Map();
  for (let k of Object.keys(obj)) {
    strMap.set(k, obj[k]);
  }
  return strMap;
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
    if (!("showServiceJobs" in prefs)) prefs["showServiceJobs"] = true;
    return {
      builds: [],
      known_jobs: [],
      currentTime: new Date(),
      updateTime: new Date(0),
      showNotifications: prefs.showNotifications,
      showServiceJobs: prefs.showServiceJobs,
      jobNameFilter: "",
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
      showServiceJobs: this.state.showServiceJobs,
    }));
    if (this.props.job !== prevProps.job || this.props.mode !== prevProps.mode) {
      this.setState(this.initialState());
      this.update();
    }
  }
  async update() {
    const currentTime = new Date();
    const branch = this.props.job.replace(/^pytorch-/, '')
    const build_prefix = branch === 'master' ? branch : 'pr';
    const url_prefix = 'https://s3.amazonaws.com/ossci-job-status';
    this.setState({currentTime: currentTime});

    const commits = await axios.get(`${url_prefix}/${branch}/index.json`);

    const requests = commits.data.map(async build => {
      try {
        const r = await axios.get(`${url_prefix}/${build_prefix}/${build.id}.json`)
        build.sb_map = objToStrMap(r.data);
      } catch (e) {
        build.sb_map = new Map();
        // swallow
      }
      return build;
    })
    const builds = await axios.all(requests)
    builds.reverse()

    const data = {}

    data.updateTime = new Date();
    data.connectedIn = data.updateTime - currentTime;

    const props_mode = this.props.mode;

    const known_jobs_set = new Set();
    builds.forEach(build => {
      build.sb_map.forEach((sb, job_name) => {
        const nightly_candidates = job_name.includes("binary_") || job_name.includes("smoke_") || job_name.includes("nightly_") || job_name.includes("nigthly_");
        const is_nightly = nightly_candidates && !nightly_run_on_pr(job_name);
        if ((props_mode !== "nightly" && !is_nightly) ||
            (props_mode === "nightly" && is_nightly)) {
          known_jobs_set.add(job_name);
        }
      });
    });

    data.known_jobs = [...known_jobs_set.values()].sort();
    data.builds = builds;

    // Figure out if we think something is broken or not.
    //  1. Consider the MOST RECENT finished build for any given sub
    //     build type.  If it is success, it's fine.
    //  2. Otherwise, check builds prior to it.  If the previous build
    //     also failed, we think it's broken!
    //
    // Special cases:
    //  - pytorch_doc_push: don't care about this
    //  - nightlies: these don't run all the time

    const failure_window = 10;
    if (this.props.job.startsWith("pytorch-")) {
      const still_unknown_set = new Set();
      const consecutive_failure_count = new Map();
      data.known_jobs.forEach((job) => {
        if (job === "pytorch_doc_push") return;
        if (job === "__dr.ci") return;
        if (job.includes("nightlies")) return;
        still_unknown_set.add(job);
      });
      for (let i = 0; i < data.builds.length; i++) {
        // After some window, don't look anymore; the job may have been
        // removed
        if (i > failure_window) break;
        if (!still_unknown_set.size) break;
        const build = data.builds[i];
        const sb_map = build.sb_map;
        sb_map.forEach((sb, jobName) => {
          if (!still_unknown_set.has(jobName)) {
            // do nothing
          } else if (is_failure(sb.status)) {
            let count = consecutive_failure_count.get(jobName) || 0;
            count++;
            consecutive_failure_count.set(jobName, count);
          } else if (is_success(sb.status)) {
            still_unknown_set.delete(jobName);
          }
        });
      }

      // Prune uninteresting alarms
      consecutive_failure_count.forEach((v, k) => {
        // Require two consecutive failure to alert
        if (v <= 1) {
          consecutive_failure_count.delete(k);
        }
      });

      data.consecutive_failure_count = consecutive_failure_count;

      // Compute what notifications to show
      // We'll take a diff and then give notifications for keys that
      // changed
      if (this.state.consecutive_failure_count) {
        this.state.consecutive_failure_count.forEach((v, key) => {
          if (!consecutive_failure_count.has(key)) {
            // It's fixed!
            new Notification("✅ " + this.props.job, {"body": summarize_job(key)});
          }
        });
      }
      consecutive_failure_count.forEach((v, key) => {
        // Don't produce notifications for initial failure!
        if (this.state.consecutive_failure_count && !this.state.consecutive_failure_count.has(key)) {
          // It's failed!
          new Notification("❌ " + this.props.job, {"body": summarize_job(key)});
        }
      });
    }

    this.setState(data);
  }

  shouldShowJob(name) {
     const jobNameFilter = this.state.jobNameFilter;
     if (jobNameFilter.length > 0 && !name.includes(jobNameFilter)) {
         return false;
     }
     if (this.state.showServiceJobs) {
         return true;
     }
     const isDockerJob = name.startsWith("ci/circleci: docker")
     const isGCJob = name.startsWith("ci/circleci: ecr_gc")
     return !(isDockerJob || name === "welcome" || isGCJob);
  }

  render() {
    function result_icon(result) {
      if (is_success(result)) return <span role="img" style={{color:"green"}} aria-label="passed">0</span>;
      if (is_skipped(result)) return <span role="img" style={{color:"gray"}} aria-label="skipped">S</span>;
      if (is_failure(result)) return <span role="img" style={{color:"red"}} aria-label="failed">X</span>;
      if (is_aborted(result)) return <span role="img" style={{color:"gray"}} aria-label="cancelled">.</span>;
      if (is_pending(result)) return <span className="animate-flicker" role="img" style={{color:"goldenrod"}} aria-label="in progress">?</span>;
      if (is_infra_failure(result)) return <span role="img" style={{color:"grey"}} aria-label="failed">X</span>;
      return result;
    }

    let builds = this.state.builds;
    let consecutive_failure_count = this.state.consecutive_failure_count;

    const visible_jobs = this.state.known_jobs.filter((name) => this.shouldShowJob(name));
    const visible_jobs_head = visible_jobs.map((jobName) =>
      <th className="rotate" key={jobName}><div className={consecutive_failure_count.has(jobName) ? "failing-header" : ""}>{summarize_job(jobName)}</div></th>
    );

    const rows = builds.map((build) => {
      let found = false;
      const sb_map = build.sb_map;

      const status_cols = visible_jobs.map((jobName) => {
        const sb = sb_map.get(jobName);
        let cell = <Fragment />;
        if (sb !== undefined) {
          found = true;
          cell = <a href={sb.build_url}
                    className="icon"
                    target="_blank"
                    alt={jobName}>
                   {result_icon(sb.status)}
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
        m = comment.match(/https:\/\/github.com\/pytorch\/pytorch\/pull\/(\d+)/);
        if (m) {
          return <Fragment><a href={"https://github.com/pytorch/pytorch/pull/" + m[1]} target="_blank">#{m[1]}</a></Fragment>;
        }
        return <Fragment />;
      }

      let author = build.author.username ? build.author.username : build.author.name;

      const desc =
          <div key={build.id}>
            {drop_pr_number(build.message).split('\n')[0]}{' '}
            <code><a href={"https://github.com/pytorch/pytorch/commit/" + build.id}
                     target="_blank">{build.id.slice(0, 7)}</a></code>
          </div>;

      // TODO: Too lazy to set up PR numbers for the old ones

      let stale = false;

      // TODO: need to store this in index or payload
      const whenString = summarize_date(build.timestamp);

      if (!found) {
        return <Fragment key={build.id} />
      }

      return (
        <tr key={build.id} className={stale ? "stale" : ""}>
          <th className="left-cell">{renderPullRequestNumber(build.message)}</th>
          <td className="left-cell" title={build.timestamp}>{whenString}</td>
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
            </li><br/>
            <li>
              <input type="checkbox" name="show-service-jobs" checked={this.state.showServiceJobs} onChange={(e) => this.setState({showServiceJobs: e.target.checked}) } />
              <label htmlFor="show-service-jobs">Show service jobs</label>
            </li><br/>
            <li>
              <label htmlFor="job-name-filter">Name filter:&nbsp;</label>
              <input type="input" name="job-name-filter" value={this.state.jobNameFilter} onChange={(e) => this.setState({jobNameFilter: e.target.value}) } />
            </li>
          </ul>
        </div>
        <table className="buildHistoryTable">
          <thead>
            <tr>
              <th className="left-cell">PR#</th>
              <th className="left-cell">Date</th>
              {visible_jobs_head}
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
