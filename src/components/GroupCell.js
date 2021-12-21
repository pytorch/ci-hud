import React from 'react'

export default function GroupCell({ toggleGroup, group, children }) {
    return (
        <div
            className="display-cell"
            style={{
                fontWeight: "bold",
                borderColor: 'Gainsboro',
                borderStyle: "solid",
                borderWidth: "1px",
            }}
            onClick={() => {
                toggleGroup(group);
            }}
            onAuxClick={() => {
                toggleGroup(group);
            }}
        >
            {children}
        </div>
    )
}
