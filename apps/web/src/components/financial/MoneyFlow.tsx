import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface FlowNode {
  icon: React.ReactNode;
  /** The account or person - what the user recognises. */
  label: string;
  /** "From" / "To", for screen readers and the small caption. */
  caption: string;
  onClick?: () => void;
  expanded?: boolean;
  /** The id of the picker this node opens. */
  controls?: string;
  /** The destination is coloured; the source stays neutral. */
  tone?: 'neutral' | 'accent';
}

interface MoneyFlowProps {
  from: FlowNode;
  to: FlowNode;
  /** True once there is an amount: the arrow starts to move. */
  moving: boolean;
}

/**
 * Where the money goes, as a picture: one circle, an arrow, another circle.
 *
 * A withdrawal is bank -> cash and a salary is employer -> bank. Saying it
 * with two labelled dropdowns made people read both to understand either;
 * drawn, it is understood before it is read. Each circle is also the control
 * for changing that side.
 */
export const MoneyFlow: React.FC<MoneyFlowProps> = ({ from, to, moving }) => (
  <div className={`mf ${moving ? 'is-moving' : ''}`}>
    <Node node={from} />
    <div className="mf-arrow" aria-hidden="true">
      <ChevronRight size={16} />
      <ChevronRight size={16} />
      <ChevronRight size={16} />
    </div>
    <Node node={to} />
  </div>
);

const Node: React.FC<{ node: FlowNode }> = ({ node }) => {
  const body = (
    <>
      <span className={`mf-circle ${node.tone === 'accent' ? 'is-accent' : ''}`}>{node.icon}</span>
      <span className="mf-caption">{node.caption}</span>
      <span className="mf-label">
        <span className="mf-label-text">{node.label}</span>
        {node.onClick && <ChevronDown size={13} className="mf-chevron" aria-hidden="true" />}
      </span>
    </>
  );
  if (!node.onClick) return <div className="mf-node">{body}</div>;
  return (
    <button
      type="button"
      className={`mf-node is-button ${node.expanded ? 'is-open' : ''}`}
      aria-expanded={node.expanded}
      aria-controls={node.controls}
      aria-label={`${node.caption}: ${node.label}. Change`}
      onClick={node.onClick}
    >
      {body}
    </button>
  );
};
