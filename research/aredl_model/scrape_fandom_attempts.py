#!/usr/bin/env python3
"""Scrape public first-victor attempt tables for the live AREDL top 500.

The crawler only accepts a wiki page when the rendered page contains the exact
Geometry Dash level ID from AREDL. This avoids silently attaching a common-name
page to the wrong level. It preserves raw attempt text and emits a normalized
count/relation when possible.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re