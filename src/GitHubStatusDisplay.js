// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component, Fragment } from "react";
import jenkins from "./Jenkins.js";
import { summarize_job, summarize_date } from "./Summarize.js";
import getGroups from "./groups/index.js";
import Tooltip from "rc-tooltip";
import axios from "axios";
import UpdateButton from "./status/UpdateButton.js";
import { BsFillCaretRightFill, BsFillCaretDownFill } from "react-icons/bs";
import { ImSpinner2 } from "react-icons/im";

import {
  is_success,
  is_skipped,
  is_failure,
  is_aborted,
  is_pending,
  is_infra_failure,
} from "./utils/JobStatusUtils";
import GroupCell from "./components/GroupCell.js";
import ResultIcon from "./components/ResultIcon.js";
import ResultCell from "./components/ResultCell.js";

function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function array_move(arr, old_index, new_index) {
  while (old_index < 0) {
    old_index += arr.length;
  }
  while (new_index < 0) {
    new_index += arr.length;
  }
  if (new_index >= arr.length) {
    var k = new_index - arr.length + 1;
    while (k--) {
      arr.push(undefined);
    }
  }
  arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
}

function computeConsecutiveFailureCount(data, failure_window = 10) {
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
  return consecutive_failure_count;
}

function getJenkinsJobName(subBuild) {
  const baseJobName = subBuild.jobName;
  if (/caffe2-builds/.test(subBuild.url)) {
    return "jenkins: caffe2-" + baseJobName;
  } else {
    return "jenkins: " + baseJobName;
  }
}

class NameFilterForm extends Component {
  constructor(props) {
    super(props);
    this.state = {
      jobNameFilter: props.defaultValue || "",
      onSubmit: props.onSubmit || ((_) => {}),
    };
  }
  render() {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          this.state.onSubmit(this.state.jobNameFilter);
        }}
      >
        <label htmlFor="job-name-filter">Name filter:&nbsp;</label>
        <input
          type="input"
          name="job-name-filter"
          id="job-name-filter"
          value={this.state.jobNameFilter}
          onChange={(e) => {
            this.setState({ jobNameFilter: e.target.value });
          }}
        />
        <input style={{ marginLeft: "3px" }} type="submit" value="Go" />
      </form>
    );
  }
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
    if (!("showNotifications" in prefs))
      prefs["showNotifications"] = !isMobile();
    if (!("groupJobs" in prefs)) prefs["groupJobs"] = true;
    let jobNameFilter = this.props.jobNameFilter || "";
    return {
      fetchedBuilds: false,
      fetchError: false,
      builds: [],
      lastUpdateDate: null,
      known_jobs: [],
      showGroups: [],
      currentTime: new Date(),
      updateTime: new Date(0),
      showNotifications: prefs.showNotifications,
      groupJobs: jobNameFilter.length === 0 ? prefs.groupJobs : false,
      jobNameFilter: jobNameFilter,
    };
  }
  componentDidMount() {
    this.update();
    this.interval = setInterval(this.update.bind(this), this.props.interval);
    if (
      !isMobile() &&
      window.Notification &&
      this.state.showNotifications &&
      window.Notification.permission !== "granted"
    ) {
      window.Notification.requestPermission();
    }
  }
  componentDidUpdate(prevProps) {
    localStorage.setItem(
      "prefs2",
      JSON.stringify({
        showNotifications: this.state.showNotifications,
        groupJobs: this.state.groupJobs,
      })
    );
    if (this.props.branch !== prevProps.branch) {
      this.setState(this.initialState());
      this.update();
    }
  }
  async addJenkinsResults(builds) {
    // Adds Jenkins results to builds array
    // Step 1. Fetch info via GraphQL
    //
    // STOP.  You want more results?  You may have noticed that on
    // Google, people suggest using allBuilds with {0,n} to make use
    // of Jenkins pagination.  However, if you do this, it will *DOS our Jeenkins
    // instance*; even when pagination is requested, Jenkins will
    // still load ALL builds into memory before servicing your
    // request.  I've filed this at https://issues.jenkins-ci.org/browse/JENKINS-49908
    let jenkins_data = await jenkins.job(`pytorch-${this.props.branch}`, {
      tree: `builds[
                url,
                number,
                duration,
                timestamp,
                result,
                actions[parameters[name,value],
                causes[shortDescription]],
                changeSet[items[commitId,comment,msg]],
                subBuilds[
                  result,jobName,url,duration,
                  build[
                    subBuilds[
                      result,jobName,url,duration,
                      build[
                        subBuilds[result,jobName,url,duration]
                      ]
                    ]
                  ]
                ]
             ]`.replace(/\s+/g, ""),
    });

    // Step 2: Build commit to build idx map
    const commitIdxMap = new Map();
    builds.forEach((build, idx) => {
      commitIdxMap[build.id] = idx;
    });

    // Step 3: Add jenkins jobs
    if (jenkins_data) {
      jenkins_data.builds.forEach((topBuild) => {
        if (topBuild.changeSet.items.length !== 1) {
          return;
        }
        const buildCommitId = topBuild.changeSet.items[0].commitId;
        if (!(buildCommitId in commitIdxMap)) {
          return;
        }
        const buildIdx = commitIdxMap[buildCommitId];
        function go(subBuild) {
          if (
            subBuild.build &&
            subBuild.build._class ===
              "com.tikal.jenkins.plugins.multijob.MultiJobBuild"
          ) {
            subBuild.build.subBuilds.forEach(go);
          } else {
            builds[buildIdx].sb_map.set(
              getJenkinsJobName(subBuild),
              Object.fromEntries([
                ["status", subBuild.result],
                ["build_url", jenkins.link(subBuild.url + "/console")],
              ])
            );
          }
        }
        topBuild.subBuilds.forEach(go);
      });
    }
  }
  async update() {
    const currentTime = new Date();
    this.setState({ currentTime: currentTime });

    const branch = this.props.branch;
    const user = this.props.user;
    const repo = this.props.repo;
    const jsonUrl = `https://s3.amazonaws.com/ossci-job-status/v6/${user}/${repo}/${branch.replace(
      "/",
      "_"
    )}.json`;
    let commits = null;
    try {
      commits = await axios.get(jsonUrl);
    } catch {
      this.setState({ fetchError: true });
      return;
    }

    // Marshal new build format into the old build format
    const builds = [];
    for (const commit of commits.data) {
      const build_map = new Map();
      for (const job of commit.jobs) {
        let status = job.status;
        if (status === "neutral") {
          status = "skipped";
        }
        if (status === "queued") {
          status = "pending";
        }
        build_map.set(job.name, {
          build_url: job.url,
          status: status,
        });
      }
      builds.push({
        author: {
          username: commit.author,
        },
        message: commit.headline + "\n" + commit.body,
        sb_map: build_map,
        id: commit.sha,
        timestamp: commit.date,
        url: `https://github.com/${this.props.user}/${this.props.repo}/commit/${commit.sha}`,
      });
    }

    if (this.props.repo === "pytorch" && branch === "master") {
      await this.addJenkinsResults(builds);
    }

    const data = {};

    data.updateTime = new Date();
    data.lastUpdateDate = new Date(commits.headers["last-modified"]);
    data.fetchedBuilds = true;
    data.connectedIn = data.updateTime - currentTime;

    const known_jobs_set = new Set();
    builds.forEach((build) => {
      build.sb_map.forEach((sb, job_name) => {
        known_jobs_set.add(job_name);
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

    if (this.props.repo === "pytorch") {
      data.consecutive_failure_count = computeConsecutiveFailureCount(data);

      // Compute what notifications to show
      // We'll take a diff and then give notifications for keys that
      // changed
      if (!isMobile()) {
        if (this.state.consecutive_failure_count) {
          this.state.consecutive_failure_count.forEach((v, key) => {
            if (!data.consecutive_failure_count.has(key)) {
              // It's fixed!
              new window.Notification("✅ " + this.props.job, {
                body: summarize_job(key),
              });
            }
          });
        }
        data.consecutive_failure_count.forEach((v, key) => {
          // Don't produce notifications for initial failure!
          if (
            this.state.consecutive_failure_count &&
            !this.state.consecutive_failure_count.has(key)
          ) {
            // It's failed!
            new window.Notification("❌ " + this.props.job, {
              body: summarize_job(key),
            });
          }
        });
      }
    }

    this.setState(data);
  }

  nameMatches(name, filter) {
    if (name.includes(filter)) {
      return true;
    }

    // try-catch this since filter is user supplied and RegExp errors on invalid
    // regexes
    try {
      const regex = new RegExp(filter);
      return Boolean(name.match(regex));
    } catch {
      return false;
    }
  }

  shouldShowJob(name) {
    const jobNameFilter = this.state.jobNameFilter;
    if (jobNameFilter.length > 0 && !this.nameMatches(name, jobNameFilter)) {
      return false;
    }
    const isDockerJob = name.startsWith("ci/circleci: docker");
    const isGCJob = name.startsWith("ci/circleci: ecr_gc");
    const isCIFlowShouldRunJob = name.endsWith("ciflow_should_run");
    const isGenerateTestMatrixJob = name.endsWith("generate-test-matrix");
    return !(
      isDockerJob ||
      name === "welcome" ||
      isGCJob ||
      isCIFlowShouldRunJob ||
      isGenerateTestMatrixJob
    );
  }

  render() {
    // Initialize the groups
    let groups = getGroups(this.props.repo);

    for (const group of groups) {
      group.jobNames = [];
    }

    if (!this.state.groupJobs) {
      groups = [];
    }

    const findGroup = (jobName) => {
      for (const group of groups) {
        if (jobName.match(group.regex)) {
          return group;
        }
      }
      return null;
    };

    const groupIsExpanded = (group) => {
      for (const stateGroup of this.state.showGroups) {
        if (stateGroup.name === group.name) {
          return true;
        }
      }
      return false;
    };

    const groupIsFailing = (group) => {
      for (const jobName of group.jobNames) {
        if (
          this.state.consecutive_failure_count &&
          this.state.consecutive_failure_count.has(jobName)
        ) {
          return true;
        }
      }

      return false;
    };

    let builds = this.state.builds;
    let consecutive_failure_count = this.state.consecutive_failure_count;

    const visibleJobs = this.state.known_jobs.filter((name) =>
      this.shouldShowJob(name)
    );

    // Collapse down groups of jobs based on a regex match to the name
    const groupedVisibleJobsMap = {};
    for (const jobName of visibleJobs) {
      let group = findGroup(jobName);

      if (!group || groupIsExpanded(group)) {
        // Fake a group of size one
        group = {
          name: jobName,
          jobNames: [jobName],
        };
      } else {
        group.jobNames.push(jobName);
      }
      groupedVisibleJobsMap[group.name] = group;
    }

    // Go from the map of name -> group to a sorted list
    let groupedVisibleJobs = [];
    for (const groupName in groupedVisibleJobsMap) {
      groupedVisibleJobs.push({
        name: groupName,
        group: groupedVisibleJobsMap[groupName],
      });
    }

    for (const group of this.state.showGroups) {
      // Keep in headers for expanded groups
      groupedVisibleJobs.push({
        name: group.name,
        group: group,
      });
    }

    // Sort by group name
    groupedVisibleJobs.sort((a, b) => {
      if (a.name < b.name) {
        return -1;
      }
      if (a.name > b.name) {
        return 1;
      }
      return 0;
    });

    // Now that jobs have been globally sorted, shuffle around the expanded groups
    // so they show up next to their group header
    for (const group of this.state.showGroups) {
      let groupBaseIndex = groupedVisibleJobs.findIndex(
        (job) => job.name === group.name
      );
      if (groupBaseIndex === null) {
        console.error(`Unable to find group ${group.name}`);
        continue;
      }

      for (const jobName of group.jobNames) {
        let jobIndex = groupedVisibleJobs.findIndex(
          (job) => job.name === jobName
        );
        if (jobIndex === null) {
          console.error(`Unable to job ${jobName} in group ${group.name}`);
          continue;
        }
        if (jobIndex < groupBaseIndex) {
          array_move(groupedVisibleJobs, jobIndex, groupBaseIndex);
        } else {
          array_move(groupedVisibleJobs, jobIndex, groupBaseIndex + 1);
        }
      }
    }

    const toggleGroup = (group) => {
      let showGroups = this.state.showGroups;

      if (groupIsExpanded(group)) {
        // Remove the group
        showGroups.pop(
          showGroups.findIndex((shownGroup) => shownGroup.name === group.name)
        );
      } else {
        showGroups.push(group);
      }
      this.setState({ showGroups: showGroups });
    };

    const visibleJobsHeaders = [];
    for (const data of groupedVisibleJobs) {
      let jobName = data.name;
      if (data.group.jobNames.length === 1) {
        jobName = data.group.jobNames[0];
      }
      let header = (
        <th className="rotate" key={jobName}>
          <div
            className={
              consecutive_failure_count &&
              consecutive_failure_count.has(jobName)
                ? "failing-header"
                : ""
            }
          >
            <span>{summarize_job(jobName)}</span>
          </div>
        </th>
      );

      if (data.group.jobNames.length > 1) {
        const group = data.group;
        let icon = <BsFillCaretRightFill />;

        if (groupIsExpanded(group)) {
          icon = <BsFillCaretDownFill />;
        }

        let headerClass = "";
        if (groupIsFailing(group)) {
          headerClass = "failing-text";
        }

        header = (
          <th className="rotate" key={jobName}>
            <div
              onClick={() => {
                toggleGroup(group);
              }}
              onAuxClick={() => {
                toggleGroup(group);
              }}
              style={{ cursor: "pointer" }}
            >
              <span style={{ color: "#d0d0d0" }}>Group </span>
              <span className={headerClass}>{group.name}</span> {icon}
            </div>
          </th>
        );
      }
      visibleJobsHeaders.push(header);
    }

    function aggregateStatus(jobs) {
      // The logic here follows these rules (in order):
      // 1. If there are no jobs, return no status
      // 2. Failed if any job is failed
      // 3. Pending if any job is pending
      // 4. Success if all jobs are success, skipped, or aborted
      // 5. Otherwise pending

      jobs = jobs.filter((x) => x !== undefined);
      if (jobs.length === 0) {
        // No jobs in the group so don't show anything
        return null;
      }

      for (const job of jobs) {
        if (is_failure(job.status) || is_infra_failure(job.status)) {
          return "failure";
        }
      }

      for (const job of jobs) {
        if (is_pending(job.status)) {
          return "pending";
        }
      }

      let allOk = true;
      for (const job of jobs) {
        if (
          !(
            is_success(job.status) ||
            is_skipped(job.status) ||
            is_aborted(job.status)
          )
        ) {
          allOk = false;
        }
      }
      if (allOk) {
        return "success";
      }

      return "pending";
    }

    const decoratedBuildUrl = (url) => {
      // Add check_suite_focus=true to GHA checkruns
      const ghaRegex = new RegExp(
        "^https://github.com/" +
          this.props.user +
          "/" +
          this.props.repo +
          "/runs/\\d+$"
      );
      if (url && url.match(ghaRegex)) {
        return url + "?check_suite_focus=true";
      }
      return url;
    };
    builds.forEach((build) => {
      build.sb_map.forEach((item) => {
        if (item.status) {
          item.status = item.status.toLowerCase();
        }
      });
    });

    const rows = builds.map((build) => {
      const sb_map = build.sb_map;

      const status_cols = groupedVisibleJobs.map((data) => {
        let cell = <Fragment />;
        let jobName = data.name;

        if (data.group.jobNames.length > 1) {
          // For groups, get the status of all the jobs in the group
          jobName = `Group: ${data.group.name}`;
          const jobs = data.group.jobNames.map((jobName) =>
            sb_map.get(jobName)
          );
          const status = aggregateStatus(jobs);
          if (status) {
            cell = (
              <GroupCell toggleGroup={toggleGroup} group={data.group}>
                <ResultIcon result={status} />
              </GroupCell>
            );
          }
        } else {
          // Ungrouped job, show it directly
          if (data.group.jobNames.length === 1) {
            jobName = data.group.jobNames[0];
          }
          const sb = sb_map.get(jobName);
          if (sb !== undefined) {
            cell = (
              <ResultCell
                url={decoratedBuildUrl(sb.build_url)}
                jobName={jobName}
              >
                <ResultIcon result={sb.status} />
              </ResultCell>
            );
          }
        }

        return (
          <Tooltip
            key={jobName}
            overlay={jobName}
            mouseLeaveDelay={0}
            placement="rightTop"
            destroyTooltipOnHide={{ keepParent: false }}
          >
            <td key={jobName} className="icon-cell">
              {cell}
            </td>
          </Tooltip>
        );
      });

      function drop_pr_number(msg) {
        return msg.replace(/\(#[0-9]+\)/, "");
      }

      const renderPullRequestNumber = (comment) => {
        let m = comment.match(/\(#(\d+)\)/);
        if (m) {
          return (
            <Fragment>
              <a
                href={`https://github.com/${this.props.user}/${this.props.repo}/pull/${m[1]}`}
                target="_blank"
                rel="noreferrer"
              >
                #{m[1]}
              </a>
            </Fragment>
          );
        }
        m = comment.match(
          /https:\/\/github.com\/pytorch\/pytorch\/pull\/(\d+)/
        );
        if (m) {
          return (
            <Fragment>
              <a
                href={`https://github.com/${this.props.user}/${this.props.repo}/pull/${m[1]}`}
                target="_blank"
                rel="noreferrer"
              >
                #{m[1]}
              </a>
            </Fragment>
          );
        }
        return <Fragment />;
      };

      let author = build.author.username;

      const desc = (
        <div key={build.id}>
          <a
            style={{ color: "#003d7f" }}
            href={`/commit/${this.props.user}/${this.props.repo}/${build.id}`}
          >
            {drop_pr_number(build.message).split("\n")[0]}{" "}
          </a>
          <code>
            <a
              href={`https://github.com/${this.props.user}/${this.props.repo}/commit/${build.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {build.id.slice(0, 7)}
            </a>
          </code>
        </div>
      );

      // TODO: Too lazy to set up PR numbers for the old ones

      let stale = false;

      // TODO: need to store this in index or payload
      const whenString = summarize_date(build.timestamp);

      // TODO: Add preference to show/hide those
      // if (!found) {
      //  return <Fragment key={build.id} />;
      // }

      return (
        <tr key={build.id} className={stale ? "stale" : ""}>
          <td className="left-cell" title={build.timestamp}>
            {whenString}
          </td>
          {status_cols}
          <td
            className="right-cell"
            style={{
              maxWidth: "6em",
              textOverflow: "ellipsis",
              overflow: "hidden",
            }}
          >
            {author}
          </td>
          <th
            className="right-cell"
            style={{ paddingLeft: "0", paddingRight: "5px" }}
          >
            {renderPullRequestNumber(build.message)}
          </th>
          <td>{desc}</td>
        </tr>
      );
    });

    let loadingInfo = null;
    if (this.state.fetchError) {
      loadingInfo = (
        <p>
          Error fetching commits, either the branch does not exist or is not
          tracked by the{" "}
          <a href="https://github.com/pytorch/test-infra/tree/main/aws/lambda/github-status-sync">
            status syncing job
          </a>
        </p>
      );
    } else if (this.state.fetchedBuilds && rows.length === 0) {
      loadingInfo = <p>Fetched data but found no rows</p>;
    } else if (!this.state.fetchedBuilds) {
      loadingInfo = (
        <div style={{ margin: "10px" }}>
          <ImSpinner2 className="icon-spin" />
        </div>
      );
    }

    let lastUpdate = null;
    if (this.state.lastUpdateDate) {
      lastUpdate = (
        <p style={{ fontSize: "0.8em" }}>
          Last updated {this.state.lastUpdateDate.toLocaleString()}{" "}
          <UpdateButton
            repo={this.props.repo}
            user={this.props.user}
            branch={this.props.branch}
          />
        </p>
      );
    }

    return (
      <div>
        <h4>
          <a
            href={`https://github.com/${this.props.user}/${this.props.repo}/commits/${this.props.branch}`}
          >
            {this.props.user}/{this.props.repo}/{this.props.branch}
          </a>{" "}
          CI history{" "}
        </h4>
        {lastUpdate}
        <div>
          <ul className="menu">
            {isMobile() ? null : (
              <li>
                <input
                  type="checkbox"
                  name="show-notifications"
                  checked={this.state.showNotifications}
                  onChange={(e) =>
                    this.setState({ showNotifications: e.target.checked })
                  }
                />
                <label htmlFor="show-notifications">
                  Show notifications on master failure
                  {this.state.showNotifications &&
                  window.Notification &&
                  window.Notification.permission === "denied" ? (
                    <Fragment>
                      {" "}
                      <strong>
                        (WARNING: notifications are currently denied)
                      </strong>
                    </Fragment>
                  ) : (
                    ""
                  )}
                </label>
              </li>
            )}
            {isMobile() ? null : <br />}
            <li>
              <input
                type="checkbox"
                name="group-jobs"
                checked={this.state.groupJobs}
                onChange={(e) => this.setState({ groupJobs: e.target.checked })}
              />
              <label htmlFor="group-jobs">Group related jobs</label>
            </li>
            <li>
              <NameFilterForm
                onSubmit={(filter) => {
                  this.setState({ jobNameFilter: filter });
                }}
                defaultValue={this.props.jobNameFilter}
              />
            </li>
          </ul>
        </div>
        {rows.length > 0 ? (
          <table className="buildHistoryTable">
            <thead>
              <tr>
                <th className="left-cell">Date</th>
                {visibleJobsHeaders}
                <th className="right-cell">User</th>
                <th className="right-cell">PR#</th>
                <th className="right-cell">Description</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        ) : null}

        {loadingInfo}
      </div>
    );
  }
}
