import React from "react"

const ListenerCountBadge = ({ count, className = "" }) => {
  return (
    <div
      className={`gradient-3 text-white px-3 py-2 rounded-full font-inter font-medium text-sm ${className}`}
    >
      <span className="mr-1">👥</span>{
        count == 0 ? "Loading..." :<>{count} {count === 1 ? "listener" : "listeners"}</>
      }
      
    </div>
  )
}

export default ListenerCountBadge
