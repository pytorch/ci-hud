// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Fragment } from "react";

export default function AsOf(props) {
  const updateStatus =
    props.currentTime - props.updateTime > props.interval ? (
      "disconnected"
    ) : (
      <Fragment>connected in {props.connectedIn}ms</Fragment>
    );
  const timeString =
    props.updateTime - new Date(0) === 0 ? (
      <Fragment>pending</Fragment>
    ) : (
      <Fragment>
        as of {props.updateTime.toLocaleTimeString()}; {updateStatus}
      </Fragment>
    );
  return <span className={updateStatus}>({timeString})</span>;
}
