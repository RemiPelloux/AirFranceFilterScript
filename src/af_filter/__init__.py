"""AF Filter — Air France / HOP-only lowest-fare calendar.

Drives a stealth Chrome session on airfrance.fr and proxies the site's GraphQL
API through it, then filters itineraries by operating carrier.
"""

__version__ = "2.0.0"
