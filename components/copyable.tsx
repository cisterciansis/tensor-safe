'use client';
import { useState } from 'react';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Network = 'finney' | 'test';
type Kind = 'account' | 'hotkey' | 'extrinsic' | 'block';
const TAOSTATS = {
  finney: 'https://taostats.io',
  test: 'https://test.taostats.io',
};
/** Taostats deep link. Blocks are linked by hash to their extrinsic list. */
export const taostats = (network: Network, kind: Kind, id: string) =>
  `${TAOSTATS[network]}/${kind}/${id}${kind === 'block' ? '/extrinsics' : ''}`;

export const short = (v: string) =>
  v.length > 16 ? v.slice(0, 7) + '…' + v.slice(-6) : v;

/**
 * An address or hash: truncated with the full value on hover, a copy button,
 * and an optional Taostats link when the network and kind are known.
 */
export function Copyable({
  value,
  full = false,
  network,
  kind,
  label = 'value',
}: {
  value: string;
  full?: boolean;
  network?: Network;
  kind?: Kind;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copyable">
      {full ? (
        <code>{value}</code>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<code />}>
            {short(value)}
          </TooltipTrigger>
          <TooltipContent className="copyable-tip">{value}</TooltipContent>
        </Tooltip>
      )}
      <button
        type="button"
        className="copy-mini"
        aria-label={`Copy ${label}`}
        title={copied ? 'Copied' : 'Copy'}
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {network && kind && (
        <a
          className="copy-mini"
          href={taostats(network, kind, value)}
          target="_blank"
          rel="noreferrer"
          aria-label={`View ${label} on Taostats`}
          title="View on Taostats"
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowUpRight size={13} />
        </a>
      )}
    </span>
  );
}
