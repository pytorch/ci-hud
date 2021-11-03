import React, { Component } from "react";

import { ImSpinner2 } from "react-icons/im";

export default class Spin extends Component {
  render() {
    return (
      <div style={{ display: "inline-block" }}>
        <ImSpinner2
          style={{ fontSize: "1em", marginRight: "5px" }}
          className="icon-spin"
        />
        <span>{this.props.text}</span>
      </div>
    );
  }
}
