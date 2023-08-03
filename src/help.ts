// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export const HOVER_HELP_DEFINITIONS: Record<string, string[]> = {
  contains: ['contains(any) → bool', 'Set membership (is B an element of A)'],
  containsAll: [
    'containsAll(set) → bool',
    'Tests if set A contains all of the elements in set B',
  ],
  containsAny: [
    'containsAny(set) → bool',
    'Tests if set A contains any of the elements in set B',
  ],
  // IPAddr extension functions
  ip: [
    'ip(string) → ipaddr',
    'Parse a string representing an IP address or range. Supports both IPv4 and IPv6. Ranges are indicated with CIDR notation (e.g. /24).',
  ],
  isIpv4: ['isIpv4() → bool', 'Tests whether an IP address is an IPv4 address'],
  isIpv6: ['isIpv6() → bool', 'Tests whether an IP address is an IPv6 address'],
  isLoopback: [
    'isLoopback() → bool',
    'Tests whether an IP address is a loopback address',
  ],
  isMulticast: [
    'isMulticast() → bool',
    'Tests whether an IP address is a multicast address',
  ],
  isInRange: [
    'isInRange(ipaddr) → bool',
    'Tests if ipaddr A is in the range indicated by ipaddr B. (If A is a range, tests whether A is a subrange of B. If B is a single address rather than a range, B is treated as a range containing a single address.)',
  ],
  // Decimal extension functions
  decimal: [
    'decimal(string) → decimal',
    'Parse a string representing a decimal value. Matches against the regular expression -?[0-9]+.[0-9]+, allowing at most 4 digits after the decimal point.',
  ],
  lessThan: [
    'lessThan(decimal) → bool',
    'Tests whether the first decimal value is less than the second',
  ],
  lessThanOrEqual: [
    'lessThanOrEqual(decimal) → bool',
    'Tests whether the first decimal value is less than or equal to the second',
  ],
  greaterThan: [
    'greaterThan(decimal) → bool',
    'Tests whether the first decimal value is greater than the second',
  ],
  greaterThanOrEqual: [
    'greaterThanOrEqual(decimal) → bool',
    'Tests whether the first decimal value is greater than or equal to the second',
  ],
};
