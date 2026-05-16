import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, Plus, X, ExternalLink, Edit3, Trash2, Save, Star,
  MapPin, Briefcase, Calendar, FileText, User, Link as LinkIcon,
  StickyNote, ChevronRight, Filter, Download, Upload, BarChart3,
  Building2, AlertCircle, CheckCircle2, Clock, Send, Loader2,
  ArrowUpDown, Eye, LayoutGrid, List as ListIcon, Sparkles,
  MessageSquare, Mail, FileEdit, Copy, ChevronDown, ChevronUp,
  GripVertical, Users, Code2, Settings, ClipboardCheck,
  Cloud, CloudOff, CloudUpload, RefreshCw, Key, Github, Shield
} from 'lucide-react';

// ===== Storage =====
const STORE_KEY = 'jobtracker_v1';
const PROFILE_KEY = 'jobtracker_profile_v1';
const GIST_CONFIG_KEY = 'jobtracker_gist_v1';
const GIST_FILE_NAME = 'job_tracker.json';

async function loadStore() {
  try {
    const r = localStorage.getItem(STORE_KEY);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}
async function saveStore(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('save failed', e);
  }
}
async function loadProfile() {
  try {
    const r = localStorage.getItem(PROFILE_KEY);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}
async function saveProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch (e) {
    console.error('profile save failed', e);
  }
}
async function loadGistConfig() {
  try {
    const r = localStorage.getItem(GIST_CONFIG_KEY);
    return r ? JSON.parse(r) : null;
  } catch {
    return null;
  }
}
async function saveGistConfig(c) {
  try {
    localStorage.setItem(GIST_CONFIG_KEY, JSON.stringify(c));
  } catch (e) {
    console.error('gist config save failed', e);
  }
}
async function clearGistConfig() {
  try {
    localStorage.removeItem(GIST_CONFIG_KEY);
  } catch (e) {
    console.error('gist config delete failed', e);
  }
}

// ===== GitHub Gist API =====
async function ghCreateGist(pat, payload) {
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      description: 'Job Application Tracker — synced state',
      public: false,
      files: {
        [GIST_FILE_NAME]: { content: JSON.stringify(payload, null, 2) },
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub API ${res.status}: ${t.slice(0, 200)}`);
  }
  return await res.json();
}

async function ghReadGist(pat, gistId) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 401) throw new Error('Invalid PAT (401). Generate a new one with "gist" scope.');
  if (res.status === 404) throw new Error('Gist not found (404). Check the gist ID, or it may have been deleted.');
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  const file = data.files[GIST_FILE_NAME] || Object.values(data.files)[0];
  if (!file) throw new Error('Gist has no data file');
  let parsed = null;
  try { parsed = JSON.parse(file.content); }
  catch { throw new Error('Gist file is not valid JSON'); }
  return { data: parsed, updatedAt: data.updated_at, htmlUrl: data.html_url };
}

async function ghWriteGist(pat, gistId, payload) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      files: { [GIST_FILE_NAME]: { content: JSON.stringify(payload, null, 2) } },
    }),
  });
  if (res.status === 401) throw new Error('Invalid PAT (401)');
  if (res.status === 404) throw new Error('Gist not found (404)');
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub API ${res.status}: ${t.slice(0, 200)}`);
  }
  return await res.json();
}

async function ghValidatePat(pat) {
  // Check the PAT has gist scope
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
    },
  });
  if (res.status === 401) throw new Error('Invalid PAT (401)');
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const scopes = (res.headers.get('x-oauth-scopes') || '').split(',').map(s => s.trim());
  const hasGist = scopes.includes('gist') || res.headers.get('x-oauth-scopes')?.includes('gist');
  // Fine-grained PATs don't return x-oauth-scopes; we'll let the actual gist call validate them
  const user = await res.json();
  return { login: user.login, name: user.name, scopes, hasGist };
}

// ===== AI Helper =====
// Local: Vite proxies /anthropic → api.anthropic.com and injects ANTHROPIC_API_KEY from .env.local (never bundled).
// Production: set VITE_ANTHROPIC_URL to your own HTTPS endpoint that proxies to Anthropic (browser cannot call Anthropic directly — CORS).
async function callClaude(systemPrompt, userPrompt) {
  const url = import.meta.env.DEV
    ? '/anthropic/v1/messages'
    : import.meta.env.VITE_ANTHROPIC_URL;
  if (!url) {
    throw new Error(
      'Anthropic is not configured. For local dev, add ANTHROPIC_API_KEY to .env.local. For production, set VITE_ANTHROPIC_URL to a server-side proxy.',
    );
  }
  const headers = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  const clientKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!import.meta.env.DEV && clientKey) {
    headers['x-api-key'] = clientKey;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
  } catch (e) {
    console.error('AI call failed', e);
    throw e;
  }
}

// ===== Constants =====
const STATUSES = [
  { id: 'not_applied',   label: 'Not Applied',       color: '#6b6b6b', dot: '○' },
  { id: 'referral',      label: 'Referral Requested', color: '#d4a574', dot: '◐' },
  { id: 'applied',       label: 'Applied',           color: '#7895c1', dot: '●' },
  { id: 'oa',            label: 'OA / Test',         color: '#9b8ec1', dot: '●' },
  { id: 'interview',     label: 'Interviewing',      color: '#c19b73', dot: '●' },
  { id: 'offer',         label: 'Offer',             color: '#7eb87e', dot: '★' },
  { id: 'rejected',      label: 'Rejected',          color: '#c87171', dot: '✕' },
  { id: 'ghosted',       label: 'Ghosted',           color: '#5a5a5a', dot: '·' },
  { id: 'on_hold',       label: 'On Hold',           color: '#a89888', dot: '◌' },
];

// Kanban column groupings — 6 columns covering the 9 statuses.
const COLUMNS = [
  { id: 'backlog',    label: 'Backlog',      statuses: ['not_applied'],                   defaultStatus: 'not_applied', accent: '#6b6b6b' },
  { id: 'outreach',   label: 'Applied',      statuses: ['referral', 'applied'],           defaultStatus: 'applied',     accent: '#7895c1' },
  { id: 'assessment', label: 'OA / Test',    statuses: ['oa'],                            defaultStatus: 'oa',          accent: '#9b8ec1' },
  { id: 'interview',  label: 'Interviewing', statuses: ['interview'],                     defaultStatus: 'interview',   accent: '#c19b73' },
  { id: 'offer',      label: 'Offer',        statuses: ['offer'],                         defaultStatus: 'offer',       accent: '#7eb87e' },
  { id: 'closed',     label: 'Closed',       statuses: ['rejected', 'ghosted', 'on_hold'],defaultStatus: 'rejected',    accent: '#5a5a5a' },
];

const statusToColumn = (statusId) => {
  const c = COLUMNS.find(col => col.statuses.includes(statusId));
  return c ? c.id : 'backlog';
};

const ROUND_TYPES = [
  { id: 'dsa',         label: 'DSA / Coding',     color: '#7895c1' },
  { id: 'system',      label: 'System Design',    color: '#c19b73' },
  { id: 'lld',         label: 'LLD / OOP',        color: '#9b8ec1' },
  { id: 'behavioral',  label: 'Behavioral',       color: '#a89888' },
  { id: 'hm',          label: 'Hiring Manager',   color: '#d4a574' },
  { id: 'bar_raiser',  label: 'Bar Raiser',       color: '#7eb87e' },
  { id: 'recruiter',   label: 'Recruiter Screen', color: '#888' },
  { id: 'other',       label: 'Other',            color: '#666' },
];

const ROUND_OUTCOMES = [
  { id: 'pending',  label: 'Pending',  color: '#a89888' },
  { id: 'passed',   label: 'Passed',   color: '#7eb87e' },
  { id: 'failed',   label: 'Failed',   color: '#c87171' },
  { id: 'unknown',  label: 'Unknown',  color: '#888' },
];

const DEFAULT_PROFILE = {
  name: 'Himanshu Dhanwanta',
  currentRole: 'SDE2',
  currentCompany: 'Intuit',
  yearsExp: '2.5',
  education: 'NIT Trichy, 2023',
  techStack: 'Java, Spring Boot, microservices, AWS, distributed systems',
  domain: 'Fintech SaaS (QuickBooks)',
  achievements: '',
  resumeBullets: '',
};

const TIER_LABELS = {
  5: 'Excellent fit',
  4: 'Strong fit',
  3: 'Good fit',
  2: 'Decent fit',
};

// ===== Seed: curated for Himanshu's profile =====
// Reasoning: SDE2 @ Intuit, NIT Trichy, backend/distributed systems, Java/Spring Boot,
// SaaS product experience (QuickBooks). Best fits = fintech SaaS, dev tools, distributed
// systems infra. Big tech = strong but competitive. HFT/banks = high pay, lower fit.
const SEED = [
  // ===== Excellent fit (5★) — SaaS / fintech / distributed systems =====
  {
    name: 'Stripe', tier: 5, locations: ['Bangalore'], role: 'L2 Software Engineer',
    domain: 'Fintech / Payments',
    fitNote: 'Fintech SaaS with strong distributed systems work. Closest analog to your Intuit experience.',
    careersUrl: 'https://stripe.com/jobs/search?office_locations=Asia+Pacific--Bengaluru',
    compLink: 'https://leetcode.com/discuss/compensation/4618551/stripe-l2-bangalore-accept',
    tags: ['high-pay', 'RSU', 'liquidity-events'],
  },
  {
    name: 'Atlassian', tier: 5, locations: ['Bangalore', 'Remote'], role: 'SDE2',
    domain: 'SaaS / Dev Tools',
    fitNote: 'Product SaaS at scale, similar to QuickBooks. Workflows, integrations — your Intuit work maps directly.',
    careersUrl: 'https://www.atlassian.com/company/careers/all-jobs?team=Engineering&location=India',
    tags: ['SaaS', 'remote-friendly'],
  },
  {
    name: 'Rubrik', tier: 5, locations: ['Bangalore', 'Pune'], role: 'G6 SDE2',
    domain: 'Data / Distributed Systems',
    fitNote: 'Distributed systems & backend infra. Post-IPO comp is very strong — even SDE1 ≈ 60-65 LPA.',
    careersUrl: 'https://www.rubrik.com/company/careers/locations/india',
    compLink: 'https://leetcode.com/discuss/compensation/5257976/Google-L4-vs-Rubrik-G6',
    tags: ['high-pay', 'IPO-stock'],
  },
  {
    name: 'Databricks', tier: 5, locations: ['Bangalore'], role: 'SDE2',
    domain: 'Data Infrastructure',
    fitNote: 'Big data / Spark / distributed systems. Pre-IPO RSU has meaningful upside.',
    careersUrl: 'https://www.databricks.com/company/careers/open-positions?location=India',
    tags: ['high-pay', 'pre-IPO-RSU'],
  },
  {
    name: 'Confluent', tier: 5, locations: ['Remote (India)'], role: 'SDE2',
    domain: 'Distributed Systems / Kafka',
    fitNote: 'Pure distributed systems play. Permanent remote. Excellent for backend platform engineers.',
    careersUrl: 'https://careers.confluent.io/en_US/careers/SearchJobs/?3_45_3=%5B%221102610%22%5D',
    tags: ['remote', 'distributed-systems'],
  },
  {
    name: 'Salesforce', tier: 5, locations: ['Bangalore', 'Hyderabad'], role: 'SMTS',
    domain: 'CRM / SaaS',
    fitNote: 'Enterprise SaaS — same product profile as Intuit/QuickBooks. Workflows, integrations, multi-tenant.',
    careersUrl: 'https://careers.salesforce.com/en/jobs/?search=&country=India&pagesize=20#results',
    tags: ['SaaS', 'enterprise'],
  },
  {
    name: 'Cohesity', tier: 5, locations: ['Bangalore'], role: 'SMTS / MTS 4',
    domain: 'Data Protection / Storage',
    fitNote: 'Backend infra, data platforms. Remote-friendly. Similar tech stack to your current work.',
    careersUrl: 'https://www.cohesity.com/company/careers/job-openings/',
    tags: ['remote-friendly'],
  },

  // ===== Strong fit (4★) — Big tech + fintech =====
  {
    name: 'Google', tier: 4, locations: ['Bangalore', 'Hyderabad', 'Pune'], role: 'L4 Software Engineer',
    domain: 'Big Tech',
    fitNote: 'Top tier. Competitive but worth applying. No engineering team in Gurgaon per LC discussion.',
    careersUrl: 'https://www.google.com/about/careers/applications/jobs/results/?location=India&target_level=MID',
    compLink: 'https://leetcode.com/discuss/compensation/5096259/Google-or-L4',
    tags: ['big-tech', 'high-pay'],
  },
  {
    name: 'Microsoft', tier: 4, locations: ['Bangalore', 'Hyderabad', 'Noida'], role: 'SE2 (L61)',
    domain: 'Big Tech',
    fitNote: 'Strong backend roles. Hyderabad and Bangalore have largest eng presence.',
    careersUrl: 'https://jobs.careers.microsoft.com/global/en/search?lc=India&exp=Experienced%20professionals',
    tags: ['big-tech'],
  },
  {
    name: 'Uber', tier: 4, locations: ['Bangalore', 'Hyderabad', 'Gurugram'], role: 'L4 SDE2',
    domain: 'Mobility / Big Tech',
    fitNote: 'Distributed systems at massive scale. Strong India presence.',
    careersUrl: 'https://www.uber.com/us/en/careers/list/?location=IND&department=Engineering',
    compLink: 'https://leetcode.com/discuss/compensation/5268625/Uber-or-L4-or-Bengaluru-or-Accepted',
    tags: ['big-tech', 'high-pay'],
  },
  {
    name: 'LinkedIn', tier: 4, locations: ['Bangalore'], role: 'SDE2',
    domain: 'Big Tech / SaaS',
    fitNote: 'Data-heavy SaaS, hybrid model. Maps well to your data-pipeline & analytics work at Intuit.',
    careersUrl: 'https://www.linkedin.com/jobs/search/?keywords=Software%20Engineer&location=India&f_C=1337',
    tags: ['big-tech', 'hybrid'],
  },
  {
    name: 'Airbnb', tier: 4, locations: ['Remote (India)'], role: 'G8 SDE2',
    domain: 'Big Tech / Travel',
    fitNote: 'Fully remote in India. High bar, strong infra teams.',
    careersUrl: 'https://careers.airbnb.com/positions/?_offices=india',
    tags: ['remote', 'big-tech'],
  },
  {
    name: 'Coinbase', tier: 4, locations: ['Remote (India)'], role: 'IC4',
    domain: 'Crypto / Fintech',
    fitNote: 'Remote-friendly fintech. Your Intuit fintech background is a clear match.',
    careersUrl: 'https://www.coinbase.com/careers/positions?gh_src=&teams%5B%5D=Engineering',
    compLink: 'https://leetcode.com/discuss/compensation/4985378/Coinbase-or-IC4-or-Remote',
    tags: ['remote', 'fintech'],
  },
  {
    name: 'Oracle (OCI)', tier: 4, locations: ['Bangalore'], role: 'SE / Senior MTS',
    domain: 'Cloud Infrastructure',
    fitNote: 'Distributed cloud infra. Heavy backend/systems work.',
    careersUrl: 'https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?location=India&locationId=300000000122831',
    tags: ['cloud', 'distributed-systems'],
  },
  {
    name: 'PhonePe', tier: 4, locations: ['Bangalore', 'Pune'], role: 'SDE2',
    domain: 'Fintech / Payments',
    fitNote: 'Dominant fintech in India. ESOP-heavy comp. Direct fit for your fintech experience.',
    careersUrl: 'https://www.phonepe.com/careers/job-openings/',
    tags: ['fintech', 'ESOP'],
  },
  {
    name: 'Rippling', tier: 4, locations: ['Bangalore'], role: 'SDE2',
    domain: 'HR / Finance SaaS',
    fitNote: 'Same product space as Intuit (HR/finance SaaS for SMBs). Excellent narrative fit.',
    careersUrl: 'https://www.rippling.com/careers/open-roles?country=India',
    tags: ['SaaS', 'ESOP'],
  },

  // ===== Good fit (3★) =====
  {
    name: 'Amazon', tier: 3, locations: ['Bangalore', 'Hyderabad', 'Gurugram', 'Chennai'], role: 'SDE2 (L5)',
    domain: 'Big Tech / Retail',
    fitNote: 'Strong backend roles, leadership principles–heavy interviews. Large India footprint.',
    careersUrl: 'https://www.amazon.jobs/en/search?base_query=software+development+engineer&loc_query=India',
    compLink: 'https://leetcode.com/discuss/compensation/5115817/Amazon-or-L5-or-Bangalore',
    tags: ['big-tech'],
  },
  {
    name: 'CRED', tier: 3, locations: ['Bangalore'], role: 'SDE2',
    domain: 'Fintech',
    fitNote: 'Premium fintech, strong eng culture. ESOP-heavy.',
    careersUrl: 'https://careers.cred.club/',
    tags: ['fintech', 'ESOP'],
  },
  {
    name: 'Razorpay', tier: 3, locations: ['Bangalore'], role: 'SDE2',
    domain: 'Fintech / Payments',
    fitNote: 'Indian fintech leader, strong engineering brand.',
    careersUrl: 'https://razorpay.com/jobs/?team=Engineering',
    tags: ['fintech'],
  },
  {
    name: 'Adobe', tier: 3, locations: ['Noida', 'Bangalore'], role: 'Computer Scientist 2',
    domain: 'SaaS / Creative Tools',
    fitNote: 'SaaS product engineering. Solid comp + WLB.',
    careersUrl: 'https://careers.adobe.com/us/en/search-results?keywords=software%20engineer&qcountry=India',
    tags: ['SaaS'],
  },
  {
    name: 'Dream11', tier: 3, locations: ['Mumbai'], role: 'SDE2',
    domain: 'Gaming / Fantasy Sports',
    fitNote: 'Mumbai-only. Very high comp, ESOP-heavy. Different domain.',
    careersUrl: 'https://careers.dream11.com/',
    compLink: 'https://leetcode.com/discuss/compensation/5017774/Dream11-or-SDE-2-or-Mumbai',
    tags: ['high-pay', 'ESOP', 'mumbai-only'],
  },
  {
    name: 'Zepto', tier: 3, locations: ['Bangalore'], role: 'SE2 / SE3',
    domain: 'Q-commerce',
    fitNote: '5-day WFO. Aggressive comp for fast-growing co.',
    careersUrl: 'https://www.zeptonow.com/careers',
    compLink: 'https://leetcode.com/discuss/compensation/5392815/Zepto-or-SDE-2-or-Bangalore-or-Accepted',
    tags: ['WFO', 'high-growth'],
  },
  {
    name: 'Postman', tier: 3, locations: ['Bangalore'], role: 'SDE2',
    domain: 'Dev Tools / SaaS',
    fitNote: 'Developer tools SaaS. API-heavy work matches your backend experience.',
    careersUrl: 'https://www.postman.com/company/careers/open-positions/',
    tags: ['dev-tools', 'SaaS'],
  },
  {
    name: 'Druva', tier: 3, locations: ['Pune'], role: 'SDE2',
    domain: 'Data Protection / SaaS',
    fitNote: 'Backend / cloud data platforms. Pune-based.',
    careersUrl: 'https://www.druva.com/about/careers',
    tags: ['SaaS'],
  },
  {
    name: 'Sumo Logic', tier: 3, locations: ['Remote', 'Bangalore'], role: 'SDE2',
    domain: 'Observability / Data',
    fitNote: 'Log analytics platform. Big data backend work.',
    careersUrl: 'https://www.sumologic.com/careers/',
    tags: ['remote-friendly'],
  },
  {
    name: 'Walmart Global Tech', tier: 3, locations: ['Bangalore'], role: 'SDE3 (≈SDE2 ext)',
    domain: 'E-commerce / Retail Tech',
    fitNote: 'Stable, strong WLB. Solid backend roles.',
    careersUrl: 'https://careers.walmart.com/results?q=software+engineer&page=1&sort=rank&country=IN',
    tags: ['stable'],
  },
  {
    name: 'Flipkart', tier: 3, locations: ['Bangalore'], role: 'SDE2',
    domain: 'E-commerce',
    fitNote: 'India e-commerce leader. Large eng org.',
    careersUrl: 'https://www.flipkartcareers.com/',
    tags: ['e-commerce'],
  },
  {
    name: 'Navi', tier: 3, locations: ['Bangalore'], role: 'SDE2',
    domain: 'Fintech',
    fitNote: 'Fintech, ESOP-included comp.',
    careersUrl: 'https://navi.com/careers',
    compLink: 'https://leetcode.com/discuss/compensation/2336506/Navi-or-SDE-2-or-Bangalore',
    tags: ['fintech', 'ESOP'],
  },
  {
    name: 'Sharechat', tier: 3, locations: ['Bangalore'], role: 'SDE2',
    domain: 'Social Media',
    fitNote: 'Indian-language social, scale challenges.',
    careersUrl: 'https://sharechat.com/careers',
    tags: ['ESOP'],
  },

  // ===== Decent fit (2★) — high pay, different domain =====
  {
    name: 'Tower Research Capital', tier: 2, locations: ['Gurugram'], role: 'Senior Software Engineer',
    domain: 'HFT / Quant',
    fitNote: 'Very high pay but C++/low-latency focus. Different from SaaS, but possible if you flex C++ background.',
    careersUrl: 'https://www.tower-research.com/open-positions/',
    compLink: 'https://leetcode.com/discuss/compensation/1583793/tower-research-capital-senior-software-engineer-gurgaon',
    tags: ['high-pay', 'HFT'],
  },
  {
    name: 'Goldman Sachs', tier: 2, locations: ['Bangalore', 'Hyderabad'], role: 'Associate / VP',
    domain: 'Investment Banking',
    fitNote: 'Stable, decent pay. Different culture from product cos.',
    careersUrl: 'https://www.goldmansachs.com/careers/search?country=India',
    tags: ['banking'],
  },
  {
    name: 'D.E. Shaw', tier: 2, locations: ['Hyderabad', 'Gurugram'], role: 'Member Technical Staff II',
    domain: 'Quant / HFT',
    fitNote: 'High bar, high pay. Quant-leaning work.',
    careersUrl: 'https://www.deshawindia.com/careers',
    tags: ['high-pay', 'quant'],
  },
  {
    name: 'Arcesium', tier: 2, locations: ['Bangalore', 'Hyderabad'], role: 'SDE2',
    domain: 'Fintech / Hedge Fund Tech',
    fitNote: 'DE Shaw spinoff. Backend work for financial systems.',
    careersUrl: 'https://www.arcesium.com/careers/',
    tags: ['fintech'],
  },

  // ===== Secondary / Warmup =====
  // Realistic offer probability for an Intuit SDE2. Strategy: build interview
  // muscle here, secure backup offers, then leverage them into primary targets.
  {
    name: 'ServiceNow', tier: 5, locations: ['Hyderabad', 'Bangalore'], role: 'SDE3', track: 'secondary',
    domain: 'Workflow SaaS',
    fitNote: 'Workflow SaaS at enterprise scale — closest analog to QuickBooks. Excellent dry run for Atlassian / Salesforce interview style.',
    careersUrl: 'https://careers.servicenow.com/jobs/?country=India',
    tags: ['SaaS', 'enterprise'],
  },
  {
    name: 'Chargebee', tier: 5, locations: ['Chennai', 'Bangalore'], role: 'SDE3', track: 'secondary',
    domain: 'Subscription Billing SaaS',
    fitNote: 'Billing platform — fintech-adjacent SaaS, nearly identical product space to Intuit. Perfect warmup before Stripe.',
    careersUrl: 'https://www.chargebee.com/careers/',
    tags: ['SaaS', 'fintech-adjacent'],
  },
  {
    name: 'Freshworks', tier: 4, locations: ['Chennai', 'Bangalore'], role: 'SE2', track: 'secondary',
    domain: 'SaaS / CRM',
    fitNote: 'NASDAQ-listed Indian SaaS. Hires consistently, decent comp, clean interview loop.',
    careersUrl: 'https://careers.freshworks.com/jobs',
    tags: ['SaaS', 'public'],
  },
  {
    name: 'Sprinklr', tier: 4, locations: ['Gurugram', 'Bangalore'], role: 'SDE', track: 'secondary',
    domain: 'Customer Experience SaaS',
    fitNote: 'Listed SaaS, good Delhi-NCR option. System-design rounds are solid practice.',
    careersUrl: 'https://careers.sprinklr.com/',
    tags: ['SaaS'],
  },
  {
    name: 'Nutanix', tier: 4, locations: ['Bangalore'], role: 'MTS3', track: 'secondary',
    domain: 'Cloud / Hyperconverged Infra',
    fitNote: 'Distributed systems work, similar tech bar to Rubrik but more reachable. Strong warmup for infra interviews.',
    careersUrl: 'https://www.nutanix.com/company/careers',
    tags: ['distributed-systems'],
  },
  {
    name: 'VMware', tier: 4, locations: ['Bangalore'], role: 'MTS3', track: 'secondary',
    domain: 'Virtualization / Cloud',
    fitNote: 'Now under Broadcom — comp has shifted, but the interview practice is gold. Deep systems work.',
    careersUrl: 'https://careers.broadcom.com/locations/india',
    tags: ['systems'],
  },
  {
    name: 'SAP Labs', tier: 4, locations: ['Bangalore'], role: 'Developer T2', track: 'secondary',
    domain: 'Enterprise SaaS / ERP',
    fitNote: 'Enterprise SaaS at scale. Calmer pace, decent comp, good practice loop.',
    careersUrl: 'https://jobs.sap.com/search/?locationsearch=India',
    tags: ['SaaS', 'enterprise'],
  },
  {
    name: 'Cisco', tier: 3, locations: ['Bangalore'], role: 'SE3', track: 'secondary',
    domain: 'Networking / Cloud',
    fitNote: 'Stable, large eng org. Easy logistics, good WLB. Low-risk interview practice.',
    careersUrl: 'https://jobs.cisco.com/jobs/SearchJobs/?6_4_3=20',
    tags: ['stable'],
  },
  {
    name: 'Samsung R&D Bangalore', tier: 3, locations: ['Bangalore'], role: 'Senior Engineer', track: 'secondary',
    domain: 'Consumer / Devices',
    fitNote: 'Active backend & platform hiring. Lower interview bar than primaries — useful confidence builder.',
    careersUrl: 'https://www.samsung.com/in/about-us/careers/',
    tags: ['stable'],
  },
  {
    name: 'NetApp', tier: 3, locations: ['Bangalore'], role: 'MTS', track: 'secondary',
    domain: 'Storage / Data',
    fitNote: 'Distributed storage systems, calm culture. Good fit if you want infra-leaning practice.',
    careersUrl: 'https://careers.netapp.com/',
    tags: ['systems'],
  },
  {
    name: 'Adobe', tier: 4, locations: ['Noida', 'Bangalore'], role: 'Computer Scientist 2', track: 'secondary',
    domain: 'SaaS / Creative Tools',
    fitNote: 'Mature SaaS, predictable loop, good comp + WLB. Strong warmup candidate.',
    careersUrl: 'https://careers.adobe.com/us/en/search-results?keywords=software%20engineer&qcountry=India',
    tags: ['SaaS'],
  },
  {
    name: 'Swiggy', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'secondary',
    domain: 'Food Delivery',
    fitNote: 'Hires consistently. Scale challenges make for great system-design practice.',
    careersUrl: 'https://careers.swiggy.com/',
    tags: ['scale'],
  },
  {
    name: 'Zomato', tier: 3, locations: ['Gurugram'], role: 'SDE2', track: 'secondary',
    domain: 'Food Delivery',
    fitNote: 'Bigger Delhi-NCR option, similar profile to Swiggy.',
    careersUrl: 'https://www.zomato.com/careers',
    tags: ['scale'],
  },
  {
    name: 'Paytm', tier: 3, locations: ['Noida', 'Bangalore'], role: 'SDE3', track: 'secondary',
    domain: 'Fintech / Payments',
    fitNote: 'Veteran Indian fintech, hires often. Good fintech-domain interview reps.',
    careersUrl: 'https://jobs.paytm.com/',
    tags: ['fintech'],
  },
  {
    name: 'Disney+ Hotstar', tier: 3, locations: ['Bangalore', 'Mumbai'], role: 'SDE2', track: 'secondary',
    domain: 'Streaming / Media',
    fitNote: 'Scale-driven system design (IPL traffic). Strong eng brand for the resume.',
    careersUrl: 'https://www.hotstar.com/in/careers',
    tags: ['scale'],
  },

  // ===== Startups =====
  // Well-funded Indian (or India-strong) startups with good eng culture.
  // Different risk/reward profile: higher ownership, meaningful ESOPs at the right stage,
  // faster impact. Mostly Series B+ or recent strong rounds.

  // -- Fintech --
  {
    name: 'Zerodha', tier: 5, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Fintech / Brokerage',
    fitNote: 'Bootstrapped, profitable, lean team, legendary eng culture. Hard to get in — worth it.',
    careersUrl: 'https://zerodha.com/careers/',
    tags: ['profitable', 'fintech', 'lean'],
  },
  {
    name: 'Groww', tier: 5, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Fintech / Wealthtech',
    fitNote: 'India\'s largest broker by active clients. Recently IPO\'d / IPO-bound — ESOP value rising.',
    careersUrl: 'https://groww.in/careers',
    tags: ['unicorn', 'pre-IPO', 'fintech'],
  },
  {
    name: 'Smallcase', tier: 5, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Fintech / Wealthtech',
    fitNote: 'Curated thematic investing. Backend-heavy. Strong eng brand among Indian fintech.',
    careersUrl: 'https://www.smallcase.com/careers',
    tags: ['fintech', 'wealthtech'],
  },
  {
    name: 'Cashfree Payments', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Fintech / Payments',
    fitNote: 'Payments infra, profitable. Razorpay-style work and tech stack.',
    careersUrl: 'https://www.cashfree.com/careers/',
    tags: ['fintech', 'payments'],
  },
  {
    name: 'M2P Fintech', tier: 5, locations: ['Chennai', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Banking-as-a-Service',
    fitNote: 'Banking APIs — pure backend / distributed systems. Unicorn, well-funded.',
    careersUrl: 'https://m2pfintech.com/careers/',
    tags: ['unicorn', 'fintech', 'B2B'],
  },
  {
    name: 'Pine Labs', tier: 4, locations: ['Noida', 'Bangalore'], role: 'SDE3', track: 'startup',
    domain: 'Merchant Payments',
    fitNote: 'Offline + online payments platform. Unicorn, IPO-bound. Large eng org.',
    careersUrl: 'https://www.pinelabs.com/careers',
    tags: ['unicorn', 'pre-IPO', 'fintech'],
  },
  {
    name: 'Clear (ClearTax)', tier: 5, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Tax & Fintech SaaS',
    fitNote: 'Tax & GST SaaS — direct Intuit/TurboTax competitor in India. Closest narrative fit on this list.',
    careersUrl: 'https://clear.in/s/careers',
    tags: ['fintech', 'tax-SaaS', 'Intuit-adjacent'],
  },
  {
    name: 'Yubi', tier: 4, locations: ['Chennai', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Debt Marketplace',
    fitNote: 'Formerly CredAvenue. Debt marketplace + AI collections platform. Unicorn.',
    careersUrl: 'https://www.go-yubi.com/careers/',
    tags: ['unicorn', 'fintech'],
  },
  {
    name: 'Slice', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Neo-banking',
    fitNote: 'Merged with NESFB. Pivoted from credit cards to banking. Check current funding before applying.',
    careersUrl: 'https://www.sliceit.com/careers',
    tags: ['fintech', 'neo-banking'],
  },
  {
    name: 'Jupiter', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Neo-banking',
    fitNote: 'Digital banking app, lean team, high ownership for engineers.',
    careersUrl: 'https://jupiter.money/careers/',
    tags: ['fintech', 'neo-banking'],
  },

  // -- AI / ML --
  {
    name: 'Sarvam AI', tier: 5, locations: ['Bangalore'], role: 'SDE2 / ML Eng', track: 'startup',
    domain: 'AI / Indic LLMs',
    fitNote: 'India\'s sovereign LLM bet. Lightspeed / Peak XV / Khosla-backed, $53M+ raised. Very hot.',
    careersUrl: 'https://www.sarvam.ai/careers',
    tags: ['AI', 'hot', 'pre-Series-B'],
  },
  {
    name: 'Krutrim', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'AI Unicorn',
    fitNote: 'Ola\'s AI unicorn ($1B+). Full-stack ambition: LLMs, cloud, chips. High-risk / high-reward.',
    careersUrl: 'https://www.olakrutrim.com/careers',
    tags: ['unicorn', 'AI'],
  },
  {
    name: 'Yellow.ai', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Conversational AI',
    fitNote: 'Global conversational AI leader. Targeting US IPO 2026-27.',
    careersUrl: 'https://yellow.ai/careers/',
    tags: ['AI', 'pre-IPO'],
  },
  {
    name: 'Observe.AI', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Call Center AI',
    fitNote: 'Voice + conversational AI for contact centers. US-HQ unicorn with strong Bangalore eng.',
    careersUrl: 'https://www.observe.ai/about-us/careers',
    tags: ['unicorn', 'AI'],
  },
  {
    name: 'Uniphore', tier: 4, locations: ['Chennai', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Conversational AI',
    fitNote: 'Global unicorn (~$2.5B). NVIDIA-backed Series F. Emotion + real-time conversational AI.',
    careersUrl: 'https://www.uniphore.com/careers/',
    tags: ['unicorn', 'AI'],
  },
  {
    name: 'Atlan', tier: 5, locations: ['Delhi NCR', 'Remote'], role: 'SDE2', track: 'startup',
    domain: 'Data Catalog SaaS',
    fitNote: 'Gartner Leader for data catalogs. ~$850M valuation, strong eng brand, remote-friendly.',
    careersUrl: 'https://atlan.com/careers/',
    tags: ['SaaS', 'data', 'remote'],
  },
  {
    name: 'Fractal Analytics', tier: 3, locations: ['Mumbai', 'Bangalore'], role: 'SDE2 / DS', track: 'startup',
    domain: 'AI / Analytics',
    fitNote: 'Established AI services + product, IPO-bound. $1.6B+ valuation. More services-heavy than product.',
    careersUrl: 'https://fractal.ai/careers/',
    tags: ['unicorn', 'pre-IPO', 'AI'],
  },
  {
    name: 'Glance (InMobi)', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'AI / Consumer',
    fitNote: 'Lock-screen AI content platform. Part of InMobi group. Decent eng org.',
    careersUrl: 'https://www.inmobi.com/company/careers',
    tags: ['AI', 'consumer'],
  },

  // -- Dev Tools / Infrastructure --
  {
    name: 'Hasura', tier: 5, locations: ['Bangalore', 'Remote'], role: 'SDE2', track: 'startup',
    domain: 'Dev Tools / GraphQL',
    fitNote: 'Open-source GraphQL + data API. Unicorn, Greenoaks-backed. Distributed systems heavy.',
    careersUrl: 'https://hasura.io/careers/',
    tags: ['unicorn', 'open-source', 'remote'],
  },
  {
    name: 'BrowserStack', tier: 5, locations: ['Mumbai', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Testing Infrastructure',
    fitNote: 'Profitable unicorn, Accel-backed. Browser/mobile testing infra — strong backend platform work.',
    careersUrl: 'https://www.browserstack.com/careers',
    tags: ['unicorn', 'profitable', 'infra'],
  },
  {
    name: 'SigNoz', tier: 5, locations: ['Bangalore', 'Remote'], role: 'SDE2', track: 'startup',
    domain: 'Observability / OSS',
    fitNote: 'YC W21. Open-source Datadog alternative. Distributed systems + observability work.',
    careersUrl: 'https://signoz.io/careers/',
    tags: ['YC', 'open-source', 'observability'],
  },
  {
    name: 'LambdaTest', tier: 3, locations: ['Noida'], role: 'SDE2', track: 'startup',
    domain: 'Testing Infrastructure',
    fitNote: 'BrowserStack competitor. Hires actively, decent comp.',
    careersUrl: 'https://www.lambdatest.com/careers',
    tags: ['infra', 'testing'],
  },
  {
    name: 'Whatfix', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Digital Adoption SaaS',
    fitNote: 'Unicorn, DRHP expected 2026. Large eng team, enterprise SaaS.',
    careersUrl: 'https://whatfix.com/careers/',
    tags: ['unicorn', 'pre-IPO', 'SaaS'],
  },
  {
    name: 'Mindtickle', tier: 4, locations: ['Pune', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Sales Enablement SaaS',
    fitNote: 'Unicorn ($1.2B+). Enterprise SaaS, decent comp + ESOPs.',
    careersUrl: 'https://www.mindtickle.com/careers/',
    tags: ['unicorn', 'SaaS'],
  },
  {
    name: 'DarwinBox', tier: 4, locations: ['Hyderabad', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'HR SaaS',
    fitNote: 'HR tech unicorn — same product space as Rippling. Workday challenger.',
    careersUrl: 'https://darwinbox.com/careers',
    tags: ['unicorn', 'SaaS', 'HR'],
  },
  {
    name: 'Tekion', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Automotive SaaS',
    fitNote: 'Cloud-native automotive retail platform. Unicorn, ex-Tesla CIO-led.',
    careersUrl: 'https://tekion.com/careers',
    tags: ['unicorn', 'SaaS'],
  },

  // -- B2B SaaS --
  {
    name: 'HighRadius', tier: 5, locations: ['Hyderabad', 'Bhubaneswar'], role: 'SDE2', track: 'startup',
    domain: 'Fintech SaaS / Order-to-Cash',
    fitNote: 'AR automation SaaS — fintech-adjacent enterprise product. Unicorn, near-IPO. Direct profile fit.',
    careersUrl: 'https://www.highradius.com/careers/',
    tags: ['unicorn', 'fintech', 'SaaS'],
  },
  {
    name: 'Innovaccer', tier: 4, locations: ['Noida'], role: 'SDE2', track: 'startup',
    domain: 'Health SaaS',
    fitNote: 'Healthcare data platform unicorn ($3.2B). US-HQ with large India eng presence.',
    careersUrl: 'https://innovaccer.com/careers',
    tags: ['unicorn', 'SaaS', 'health'],
  },
  {
    name: 'Multiplier', tier: 5, locations: ['Bangalore', 'Remote'], role: 'SDE2', track: 'startup',
    domain: 'Global HR / Payroll SaaS',
    fitNote: 'EOR + global payroll SaaS. Same product space as Rippling. Sequoia-backed, remote-friendly.',
    careersUrl: 'https://www.usemultiplier.com/careers',
    tags: ['SaaS', 'remote', 'HR'],
  },
  {
    name: 'SirionLabs', tier: 4, locations: ['Gurgaon', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Contract Lifecycle Management',
    fitNote: 'CLM SaaS, Tiger Global / Sequoia-backed. Backend-heavy enterprise product.',
    careersUrl: 'https://www.sirion.ai/careers/',
    tags: ['SaaS', 'enterprise'],
  },
  {
    name: 'LeadSquared', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'CRM / Sales SaaS',
    fitNote: 'Unicorn ($1B+). Sales execution platform. Active hiring.',
    careersUrl: 'https://www.leadsquared.com/careers/',
    tags: ['unicorn', 'SaaS'],
  },

  // -- Commerce --
  {
    name: 'Meesho', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Social Commerce',
    fitNote: 'Unicorn (~$4.9B), IPO-bound. Scale-heavy backend, large eng org.',
    careersUrl: 'https://www.meesho.io/careers/',
    tags: ['unicorn', 'scale', 'pre-IPO'],
  },
  {
    name: 'Udaan', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'B2B E-commerce',
    fitNote: 'B2B marketplace unicorn. Distributed systems for logistics + payments at scale.',
    careersUrl: 'https://udaan.com/careers',
    tags: ['unicorn', 'B2B'],
  },
  {
    name: 'Licious', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'D2C Food',
    fitNote: 'Unicorn meat delivery. Supply-chain + commerce tech.',
    careersUrl: 'https://www.licious.in/careers',
    tags: ['unicorn', 'D2C'],
  },

  // -- Mobility --
  {
    name: 'Rapido', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Mobility / Bike Taxis',
    fitNote: 'Unicorn (2024). Mapping + matching + payments — distributed systems at scale.',
    careersUrl: 'https://rapido.bike/careers',
    tags: ['unicorn', 'mobility'],
  },
  {
    name: 'BluSmart', tier: 3, locations: ['Gurgaon', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'EV Mobility',
    fitNote: 'EV ride-hailing. Backend + fleet management. Fast growing.',
    careersUrl: 'https://www.blu-smart.com/careers',
    tags: ['mobility', 'EV'],
  },

  // -- HealthTech --
  {
    name: 'Cult.fit', tier: 2, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Healthtech / Fitness',
    fitNote: 'Unicorn. Consumer health + fitness. ESOP-included comp.',
    careersUrl: 'https://www.cult.fit/careers',
    tags: ['unicorn', 'consumer'],
  },
  {
    name: 'Pristyn Care', tier: 2, locations: ['Gurgaon'], role: 'SDE2', track: 'startup',
    domain: 'Healthtech',
    fitNote: 'Elective surgery platform unicorn. Operations + product engineering.',
    careersUrl: 'https://www.pristyncare.com/careers/',
    tags: ['unicorn', 'health'],
  },

  // -- EdTech --
  {
    name: 'PhysicsWallah', tier: 3, locations: ['Noida', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'EdTech',
    fitNote: 'Rare profitable EdTech unicorn. Listed in 2024. Hires actively.',
    careersUrl: 'https://www.physicswallah.com/careers',
    tags: ['unicorn', 'profitable', 'public'],
  },
  {
    name: 'Scaler / InterviewBit', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'EdTech / Coding',
    fitNote: 'Tech-focused upskilling. Engineering-heavy product, smaller team.',
    careersUrl: 'https://www.scaler.com/careers/',
    tags: ['edtech'],
  },

  // -- Crypto / Web3 --
  {
    name: 'CoinDCX', tier: 2, locations: ['Mumbai'], role: 'SDE2', track: 'startup',
    domain: 'Crypto Exchange',
    fitNote: 'India\'s largest crypto exchange. Unicorn, but regulatory headwinds.',
    careersUrl: 'https://coindcx.com/careers',
    tags: ['unicorn', 'crypto'],
  },
  {
    name: 'Polygon Labs', tier: 4, locations: ['Bangalore', 'Remote'], role: 'SDE2', track: 'startup',
    domain: 'Blockchain / Web3 Infra',
    fitNote: 'Global Web3 powerhouse (originally Matic). Infra-heavy, remote, often USD comp.',
    careersUrl: 'https://polygon.technology/careers',
    tags: ['Web3', 'remote', 'USD-comp'],
  },

  // -- Gaming --
  {
    name: 'Games24x7', tier: 3, locations: ['Mumbai', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Online Gaming',
    fitNote: 'RummyCircle, My11Circle. Unicorn, profitable, very high cash comp.',
    careersUrl: 'https://games24x7.com/careers',
    tags: ['unicorn', 'profitable', 'high-pay'],
  },

  // -- Retail / Insurance / Logistics --
  {
    name: 'Lenskart', tier: 3, locations: ['Faridabad', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Retail / E-commerce',
    fitNote: 'Eyewear unicorn, IPO-bound 2026. Retail tech eng.',
    careersUrl: 'https://www.lenskart.com/careers',
    tags: ['unicorn', 'pre-IPO'],
  },
  {
    name: 'NoBroker', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Real Estate / PropTech',
    fitNote: 'Real estate unicorn. Backend-heavy: matching + payments.',
    careersUrl: 'https://www.nobroker.in/careers',
    tags: ['unicorn', 'proptech'],
  },
  {
    name: 'CarDekho', tier: 3, locations: ['Jaipur', 'Gurgaon', 'Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Auto Marketplace',
    fitNote: 'Auto unicorn. Large eng. Reasonable comp.',
    careersUrl: 'https://www.cardekho.com/careers',
    tags: ['unicorn', 'auto'],
  },
  {
    name: 'Acko', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'InsurTech',
    fitNote: 'Digital-first insurance unicorn. Fintech-adjacent — strong profile fit.',
    careersUrl: 'https://www.acko.com/careers/',
    tags: ['unicorn', 'fintech', 'insurance'],
  },
  {
    name: 'Digit Insurance', tier: 4, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'InsurTech',
    fitNote: 'Listed insurtech (post-IPO). ESOP value + stability. Backend + product roles.',
    careersUrl: 'https://www.godigit.com/careers',
    tags: ['public', 'fintech'],
  },
  {
    name: 'KreditBee', tier: 3, locations: ['Bangalore'], role: 'SDE2', track: 'startup',
    domain: 'Digital Lending',
    fitNote: 'Lending unicorn. Active hiring, decent comp.',
    careersUrl: 'https://www.kreditbee.in/careers',
    tags: ['unicorn', 'fintech', 'lending'],
  },
  {
    name: 'Shiprocket', tier: 3, locations: ['Gurgaon'], role: 'SDE2', track: 'startup',
    domain: 'Logistics / E-commerce SaaS',
    fitNote: 'Logistics aggregator for SMBs. Public. SaaS-style product.',
    careersUrl: 'https://www.shiprocket.in/careers/',
    tags: ['public', 'SaaS', 'logistics'],
  },
];

// ===== Helpers =====
const newId = () => 'c_' + Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const getStatus = (id) => STATUSES.find(s => s.id === id) || STATUSES[0];
const linkedinJobsUrl = (company, role) =>
  `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(role || 'software engineer')}%20${encodeURIComponent(company)}&location=India`;
const referralPostUrl = (company) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company + ' recruiter')}&origin=GLOBAL_SEARCH_HEADER`;

const tierStars = (t) => '★'.repeat(t) + '☆'.repeat(5 - t);

function normalize(seedItem) {
  return {
    id: newId(),
    name: seedItem.name,
    tier: seedItem.tier,
    track: seedItem.track || 'primary',
    locations: seedItem.locations || [],
    role: seedItem.role || '',
    domain: seedItem.domain || '',
    fitNote: seedItem.fitNote || '',
    careersUrl: seedItem.careersUrl || '',
    compLink: seedItem.compLink || '',
    tags: seedItem.tags || [],
    status: 'not_applied',
    jobLink: '',
    resumeVersion: '',
    contactName: '',
    contactInfo: '',
    appliedDate: '',
    followUpDate: '',
    notes: '',
    referralAsked: false,
    rounds: [],
    createdAt: Date.now(),
  };
}

// ===== Sub-components =====
const Tag = ({ children, tone = 'neutral' }) => {
  const tones = {
    neutral: 'bg-stone-800/60 text-stone-300 border-stone-700/60',
    accent:  'bg-amber-900/30 text-amber-200/90 border-amber-700/40',
    success: 'bg-emerald-900/30 text-emerald-200/90 border-emerald-700/40',
    danger:  'bg-rose-900/30 text-rose-200/90 border-rose-700/40',
    info:    'bg-sky-900/30 text-sky-200/90 border-sky-700/40',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-wider border rounded-sm font-mono ${tones[tone]}`}>
      {children}
    </span>
  );
};

const StatusPill = ({ status }) => {
  const s = getStatus(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm text-xs font-mono border"
      style={{ color: s.color, borderColor: s.color + '55', background: s.color + '15' }}
    >
      <span aria-hidden>{s.dot}</span>
      <span>{s.label}</span>
    </span>
  );
};

const StatBox = ({ label, value, hint }) => (
  <div className="px-4 py-3 border border-stone-800 bg-stone-950/60 min-w-[140px]">
    <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-mono">{label}</div>
    <div className="flex items-baseline gap-2 mt-1">
      <span className="font-serif text-3xl text-stone-100">{value}</span>
      {hint && <span className="text-[11px] text-stone-500 font-mono">{hint}</span>}
    </div>
  </div>
);

// ===== Detail Panel =====
function DetailPanel({ item, profile, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(item);
  const isNew = !item?.name;

  useEffect(() => { setDraft(item); }, [item]);

  if (!draft) return null;

  const update = (patch) => setDraft(d => ({ ...d, ...patch }));

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-2xl bg-stone-950 border-l border-stone-800 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-stone-950/95 backdrop-blur border-b border-stone-800 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-amber-500/80 font-mono">
              {isNew ? 'New Application' : 'Edit Application'}
            </div>
            <h2 className="font-serif text-2xl text-stone-100 mt-0.5">{draft.name || 'Untitled'}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-900 rounded text-stone-400 hover:text-stone-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Identity */}
          <Section title="Company">
            <Field label="Track">
              <div className="flex gap-2 flex-wrap">
                {[
                  { id: 'primary',   label: 'Primary',  desc: '70 LPA+ goal',     color: 'amber'   },
                  { id: 'secondary', label: 'Warmup',   desc: 'practice + backup', color: 'stone'   },
                  { id: 'startup',   label: 'Startup',  desc: 'ESOP + ownership',  color: 'emerald' },
                ].map(t => {
                  const active = (draft.track || 'primary') === t.id;
                  const activeCls = t.color === 'emerald'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                    : t.color === 'stone'
                    ? 'border-stone-400 bg-stone-500/10 text-stone-200'
                    : 'border-amber-500 bg-amber-500/10 text-amber-300';
                  const descCls = active
                    ? (t.color === 'emerald' ? 'text-emerald-500/70' : t.color === 'stone' ? 'text-stone-400/80' : 'text-amber-500/70')
                    : 'text-stone-500';
                  return (
                    <button key={t.id} onClick={() => update({ track: t.id })}
                      className={`flex-1 min-w-[110px] px-3 py-2 text-left border rounded-sm transition-all ${
                        active ? activeCls : 'border-stone-700 text-stone-400 hover:border-stone-600'
                      }`}>
                      <div className="text-xs font-mono">{t.label}</div>
                      <div className={`text-[10px] mt-0.5 font-mono ${descCls}`}>
                        {t.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Company name">
              <input
                value={draft.name}
                onChange={e => update({ name: e.target.value })}
                className="input"
                placeholder="e.g. Stripe"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role / Level">
                <input value={draft.role} onChange={e => update({ role: e.target.value })} className="input" placeholder="L4 / SDE2" />
              </Field>
              <Field label="Domain">
                <input value={draft.domain} onChange={e => update({ domain: e.target.value })} className="input" placeholder="Fintech / SaaS" />
              </Field>
            </div>
            <Field label="Locations (comma separated)">
              <input
                value={(draft.locations || []).join(', ')}
                onChange={e => update({ locations: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                className="input" placeholder="Bangalore, Pune"
              />
            </Field>
            <Field label="Fit rating">
              <div className="flex items-center gap-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => update({ tier: n })}
                    className={`text-2xl transition-colors ${n <= draft.tier ? 'text-amber-400' : 'text-stone-700 hover:text-stone-500'}`}>
                    ★
                  </button>
                ))}
                <span className="ml-3 text-xs text-stone-500 font-mono">{TIER_LABELS[draft.tier] || ''}</span>
              </div>
            </Field>
            <Field label="Why it's a fit (your notes)">
              <textarea value={draft.fitNote} onChange={e => update({ fitNote: e.target.value })} className="input min-h-[60px]" rows={2} />
            </Field>
          </Section>

          {/* Application */}
          <Section title="Application">
            <Field label="Status">
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map(s => (
                  <button key={s.id} onClick={() => update({ status: s.id })}
                    className={`px-2.5 py-1 text-xs font-mono border rounded-sm transition-all`}
                    style={{
                      color: draft.status === s.id ? s.color : '#888',
                      borderColor: draft.status === s.id ? s.color + 'aa' : '#3a3a3a',
                      background: draft.status === s.id ? s.color + '22' : 'transparent',
                    }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Applied date">
                <input type="date" value={draft.appliedDate} onChange={e => update({ appliedDate: e.target.value })} className="input" />
              </Field>
              <Field label="Follow-up by">
                <input type="date" value={draft.followUpDate} onChange={e => update({ followUpDate: e.target.value })} className="input" />
              </Field>
            </div>
            <Field label="Job posting URL">
              <input value={draft.jobLink} onChange={e => update({ jobLink: e.target.value })} className="input" placeholder="https://..." />
            </Field>
            <Field label="Resume version">
              <input value={draft.resumeVersion} onChange={e => update({ resumeVersion: e.target.value })} className="input" placeholder="e.g. v3 — backend platform focus" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-stone-300 cursor-pointer">
              <input type="checkbox" checked={!!draft.referralAsked} onChange={e => update({ referralAsked: e.target.checked })}
                className="accent-amber-500" />
              <span>Referral asked</span>
            </label>
          </Section>

          {/* Contact */}
          <Section title="Contact / Referral">
            <Field label="Contact person">
              <input value={draft.contactName} onChange={e => update({ contactName: e.target.value })} className="input" placeholder="Name" />
            </Field>
            <Field label="Contact info">
              <input value={draft.contactInfo} onChange={e => update({ contactInfo: e.target.value })} className="input" placeholder="LinkedIn / email" />
            </Field>
          </Section>

          {/* Notes */}
          <Section title="Notes">
            <textarea value={draft.notes} onChange={e => update({ notes: e.target.value })}
              className="input min-h-[120px]" rows={5}
              placeholder="Interview prep notes, conversations, gotchas..." />
          </Section>

          {/* Interview Rounds */}
          <Section title="Interview Rounds">
            <RoundsSection
              rounds={draft.rounds || []}
              onChange={(newRounds) => update({ rounds: newRounds })}
            />
          </Section>

          {/* AI Co-pilot */}
          <Section title="AI Co-pilot">
            <AICopilotSection item={draft} profile={profile} />
          </Section>

          {/* Links */}
          <Section title="Quick Links">
            <div className="flex flex-wrap gap-2">
              {draft.careersUrl && (
                <a href={draft.careersUrl} target="_blank" rel="noreferrer" className="link-pill">
                  <Briefcase size={12} /> Careers page <ExternalLink size={11} />
                </a>
              )}
              {draft.compLink && (
                <a href={draft.compLink} target="_blank" rel="noreferrer" className="link-pill">
                  <BarChart3 size={12} /> Comp on LeetCode <ExternalLink size={11} />
                </a>
              )}
              {draft.name && (
                <>
                  <a href={linkedinJobsUrl(draft.name, draft.role)} target="_blank" rel="noreferrer" className="link-pill">
                    <Search size={12} /> Open jobs on LinkedIn <ExternalLink size={11} />
                  </a>
                  <a href={referralPostUrl(draft.name)} target="_blank" rel="noreferrer" className="link-pill">
                    <User size={12} /> Find recruiter <ExternalLink size={11} />
                  </a>
                </>
              )}
            </div>
          </Section>
        </div>

        <div className="sticky bottom-0 bg-stone-950/95 backdrop-blur border-t border-stone-800 px-6 py-3 flex items-center justify-between">
          {!isNew && (
            <button onClick={() => onDelete(draft.id)}
              className="text-rose-400/80 hover:text-rose-300 text-sm flex items-center gap-1.5">
              <Trash2 size={14} /> Delete
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} className="px-4 py-2 text-sm text-stone-400 hover:text-stone-200">Cancel</button>
            <button
              onClick={() => onSave(draft)}
              disabled={!draft.name}
              className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-400 text-stone-950 font-medium rounded-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Save size={14} /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const Section = ({ title, children }) => (
  <div>
    <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-mono mb-3 pb-2 border-b border-stone-800/60">
      {title}
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);
const Field = ({ label, children }) => (
  <label className="block">
    <div className="text-[11px] text-stone-400 font-mono mb-1.5">{label}</div>
    {children}
  </label>
);

// ===== Company Card =====
function CompanyCard({ item, onOpen, showTrack }) {
  const s = getStatus(item.status);
  const track = item.track || 'primary';
  return (
    <button
      onClick={() => onOpen(item)}
      className="group w-full text-left p-4 border border-stone-800 hover:border-amber-700/60 bg-stone-950/40 hover:bg-stone-900/60 transition-all rounded-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1 flex-wrap">
            <span className="text-amber-400 font-mono text-xs tracking-wider" title={TIER_LABELS[item.tier]}>
              {tierStars(item.tier)}
            </span>
            <h3 className="font-serif text-xl text-stone-100 truncate">{item.name}</h3>
            {showTrack && (
              <span className={`text-[9px] uppercase tracking-[0.18em] font-mono px-1.5 py-0.5 rounded-sm border ${
                track === 'primary'
                  ? 'border-amber-700/40 text-amber-400/80 bg-amber-900/15'
                  : track === 'startup'
                  ? 'border-emerald-700/40 text-emerald-400/80 bg-emerald-900/15'
                  : 'border-stone-700 text-stone-500 bg-stone-900/30'
              }`}>
                {track === 'primary' ? 'Primary' : track === 'startup' ? 'Startup' : 'Warmup'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-400 font-mono mb-2">
            {item.role && <span>{item.role}</span>}
            {item.domain && <><span className="text-stone-700">·</span><span>{item.domain}</span></>}
            {item.locations?.length > 0 && <><span className="text-stone-700">·</span>
              <span className="flex items-center gap-1"><MapPin size={11} />{item.locations.join(', ')}</span></>}
          </div>
          {item.fitNote && (
            <p className="text-sm text-stone-400/80 line-clamp-2 leading-relaxed mb-3">
              {item.fitNote}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={item.status} />
            {item.referralAsked && <Tag tone="accent">Referral</Tag>}
            {item.appliedDate && (
              <span className="text-[11px] text-stone-500 font-mono flex items-center gap-1">
                <Calendar size={10} /> {fmtDate(item.appliedDate)}
              </span>
            )}
            {item.followUpDate && (
              <span className="text-[11px] text-amber-500/80 font-mono flex items-center gap-1">
                <Clock size={10} /> follow-up {fmtDate(item.followUpDate)}
              </span>
            )}
            {item.rounds && item.rounds.length > 0 && (
              <span className="text-[11px] text-stone-400 font-mono flex items-center gap-1">
                <ClipboardCheck size={10} /> {item.rounds.length} round{item.rounds.length !== 1 ? 's' : ''}
              </span>
            )}
            {(item.tags || []).slice(0, 3).map(t => <Tag key={t}>{t}</Tag>)}
          </div>
        </div>
        <ChevronRight className="text-stone-600 group-hover:text-amber-400 transition-colors flex-shrink-0 mt-1" size={18} />
      </div>
    </button>
  );
}

// ===== Compact Board Card (for Kanban) =====
function BoardCard({ item, onOpen, onDragStart, onDragEnd, isDragging }) {
  const s = getStatus(item.status);
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(item)}
      className={`group p-3 mb-2 border bg-stone-950/70 hover:bg-stone-900/80 rounded-sm cursor-pointer transition-all ${
        isDragging ? 'opacity-30 border-amber-700/60' : 'border-stone-800 hover:border-amber-700/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400/80 font-mono text-[10px]" title={TIER_LABELS[item.tier]}>
              {'★'.repeat(item.tier)}
            </span>
            <h4 className="font-serif text-base text-stone-100 truncate">{item.name}</h4>
          </div>
          {item.role && (
            <div className="text-[11px] text-stone-500 font-mono truncate mt-0.5">{item.role}</div>
          )}
        </div>
        <GripVertical size={12} className="text-stone-700 group-hover:text-stone-500 flex-shrink-0 mt-1" />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="inline-flex items-center px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-mono rounded-sm"
          style={{ color: s.color, background: s.color + '18' }}
        >
          {s.label}
        </span>
        {item.followUpDate && (
          <span className="text-[9px] text-amber-500/80 font-mono flex items-center gap-0.5">
            <Clock size={9} /> {fmtDate(item.followUpDate)}
          </span>
        )}
        {item.rounds && item.rounds.length > 0 && (
          <span className="text-[9px] text-stone-400 font-mono flex items-center gap-0.5">
            <ClipboardCheck size={9} /> {item.rounds.length}r
          </span>
        )}
      </div>
    </div>
  );
}

// ===== Board (Kanban) View =====
function BoardView({ items, onOpen, onStatusChange }) {
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  const handleDragStart = (e, item) => {
    e.dataTransfer.setData('itemId', item.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(item.id);
  };
  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverCol(null);
  };
  const handleDragOver = (e, colId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colId);
  };
  const handleDragLeave = (e, colId) => {
    if (dragOverCol === colId) setDragOverCol(null);
  };
  const handleDrop = (e, col) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('itemId');
    const item = items.find(i => i.id === id);
    if (!item) return;
    // Only change if dropped into a different column
    if (!col.statuses.includes(item.status)) {
      onStatusChange(id, col.defaultStatus);
    }
    setDraggingId(null);
    setDragOverCol(null);
  };

  const byCol = useMemo(() => {
    const m = {};
    COLUMNS.forEach(c => { m[c.id] = []; });
    items.forEach(it => {
      const cId = statusToColumn(it.status);
      if (m[cId]) m[cId].push(it);
    });
    return m;
  }, [items]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUMNS.map(col => {
        const colItems = byCol[col.id] || [];
        const isOver = dragOverCol === col.id;
        return (
          <div
            key={col.id}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={(e) => handleDragLeave(e, col.id)}
            onDrop={(e) => handleDrop(e, col)}
            className={`flex-shrink-0 w-64 rounded-sm transition-colors ${
              isOver ? 'bg-amber-500/5 ring-1 ring-amber-500/40' : 'bg-stone-900/30'
            }`}
            style={{ minHeight: '70vh' }}
          >
            <div
              className="px-3 py-2.5 border-b sticky top-0 bg-stone-950/95 backdrop-blur rounded-t-sm"
              style={{ borderColor: col.accent + '40' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.accent }} />
                  <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: col.accent }}>
                    {col.label}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-stone-500">{colItems.length}</span>
              </div>
            </div>
            <div className="p-2">
              {colItems.length === 0 ? (
                <div className="text-[10px] text-stone-600 font-mono text-center py-6 italic">
                  drop here
                </div>
              ) : (
                colItems.map(it => (
                  <BoardCard
                    key={it.id}
                    item={it}
                    onOpen={onOpen}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    isDragging={draggingId === it.id}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== Interview Rounds Section =====
function RoundsSection({ rounds, onChange }) {
  const [expanded, setExpanded] = useState(null); // round id
  const addRound = () => {
    const newRound = {
      id: 'r_' + Math.random().toString(36).slice(2, 10),
      date: todayISO(),
      type: 'dsa',
      interviewer: '',
      interviewerLink: '',
      questions: '',
      selfRating: 0,
      outcome: 'pending',
      notes: '',
    };
    onChange([...(rounds || []), newRound]);
    setExpanded(newRound.id);
  };
  const updateRound = (rid, patch) => {
    onChange((rounds || []).map(r => r.id === rid ? { ...r, ...patch } : r));
  };
  const deleteRound = (rid) => {
    onChange((rounds || []).filter(r => r.id !== rid));
  };

  const sorted = [...(rounds || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return (
    <div className="space-y-2">
      {sorted.length === 0 && (
        <div className="text-[11px] text-stone-500 italic font-mono py-2">
          No rounds logged. Add one for each interview as it happens — builds your prep journal.
        </div>
      )}
      {sorted.map((r, idx) => {
        const rt = ROUND_TYPES.find(t => t.id === r.type) || ROUND_TYPES[0];
        const oc = ROUND_OUTCOMES.find(o => o.id === r.outcome) || ROUND_OUTCOMES[0];
        const isOpen = expanded === r.id;
        return (
          <div key={r.id} className="border border-stone-800 rounded-sm bg-stone-950/40">
            <div
              className="px-3 py-2 cursor-pointer flex items-center justify-between gap-2"
              onClick={() => setExpanded(isOpen ? null : r.id)}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[10px] font-mono text-stone-500">R{idx + 1}</span>
                <span
                  className="px-1.5 py-0.5 text-[10px] font-mono rounded-sm"
                  style={{ color: rt.color, background: rt.color + '20' }}
                >
                  {rt.label}
                </span>
                <span className="text-[11px] text-stone-400 font-mono">{fmtDate(r.date)}</span>
                {r.interviewer && (
                  <span className="text-[11px] text-stone-500 truncate">· {r.interviewer}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className="px-1.5 py-0.5 text-[10px] font-mono rounded-sm"
                  style={{ color: oc.color, background: oc.color + '20' }}
                >
                  {oc.label}
                </span>
                {isOpen ? <ChevronUp size={14} className="text-stone-500" /> : <ChevronDown size={14} className="text-stone-500" />}
              </div>
            </div>
            {isOpen && (
              <div className="px-3 pb-3 pt-1 border-t border-stone-800/60 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-stone-500 font-mono mb-1">Date</div>
                    <input type="date" value={r.date} onChange={e => updateRound(r.id, { date: e.target.value })}
                      className="input text-xs" />
                  </div>
                  <div>
                    <div className="text-[10px] text-stone-500 font-mono mb-1">Round type</div>
                    <select value={r.type} onChange={e => updateRound(r.id, { type: e.target.value })}
                      className="input text-xs">
                      {ROUND_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-stone-500 font-mono mb-1">Interviewer</div>
                    <input value={r.interviewer} onChange={e => updateRound(r.id, { interviewer: e.target.value })}
                      className="input text-xs" placeholder="Name" />
                  </div>
                  <div>
                    <div className="text-[10px] text-stone-500 font-mono mb-1">LinkedIn</div>
                    <input value={r.interviewerLink} onChange={e => updateRound(r.id, { interviewerLink: e.target.value })}
                      className="input text-xs" placeholder="URL" />
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-stone-500 font-mono mb-1">Questions asked</div>
                  <textarea value={r.questions} onChange={e => updateRound(r.id, { questions: e.target.value })}
                    className="input text-xs min-h-[60px]" rows={3}
                    placeholder="e.g. LC #200 variant, design rate limiter, behavioral on conflict..." />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-stone-500 font-mono mb-1">Self-rating</div>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map(n => (
                        <button key={n} onClick={() => updateRound(r.id, { selfRating: n })}
                          className={`text-lg ${n <= (r.selfRating || 0) ? 'text-amber-400' : 'text-stone-700 hover:text-stone-500'}`}>
                          ★
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-stone-500 font-mono mb-1">Outcome</div>
                    <select value={r.outcome} onChange={e => updateRound(r.id, { outcome: e.target.value })}
                      className="input text-xs">
                      {ROUND_OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-stone-500 font-mono mb-1">Notes</div>
                  <textarea value={r.notes} onChange={e => updateRound(r.id, { notes: e.target.value })}
                    className="input text-xs min-h-[60px]" rows={3}
                    placeholder="What went well, what tripped you up, what to review for next time..." />
                </div>
                <button onClick={() => deleteRound(r.id)}
                  className="text-rose-400/80 hover:text-rose-300 text-[11px] font-mono flex items-center gap-1">
                  <Trash2 size={11} /> Delete round
                </button>
              </div>
            )}
          </div>
        );
      })}
      <button onClick={addRound}
        className="w-full px-3 py-2 border border-dashed border-stone-700 hover:border-amber-700/60 text-stone-500 hover:text-amber-400 text-xs font-mono rounded-sm flex items-center justify-center gap-1.5">
        <Plus size={12} /> Add round
      </button>
    </div>
  );
}

// ===== AI Co-pilot Section =====
function AICopilotSection({ item, profile }) {
  const [activeAction, setActiveAction] = useState(null); // 'referral' | 'followup' | 'tailor'
  const [jdText, setJdText] = useState('');
  const [contactRole, setContactRole] = useState('engineer at the company');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const profileSummary = profile ? `
Name: ${profile.name || ''}
Current role: ${profile.currentRole || ''} at ${profile.currentCompany || ''}
Years of experience: ${profile.yearsExp || ''}
Education: ${profile.education || ''}
Tech stack: ${profile.techStack || ''}
Domain experience: ${profile.domain || ''}
Notable achievements: ${profile.achievements || '(not provided)'}
`.trim() : '';

  const runReferral = async () => {
    setLoading(true); setError(''); setOutput('');
    try {
      const sys = `You are helping a software engineer write personalized LinkedIn outreach messages to request a referral. Rules:
- Keep messages under 130 words.
- Open with a specific, genuine reason for reaching out (something about the company's product, recent news, or the recipient's work).
- Concisely state who the sender is (current role + 1 relevant credibility marker).
- State the specific role they're applying for.
- End with a clear, low-friction ask (referral, intro, or short chat).
- Tone: warm, professional, confident — never desperate or generic.
- Do NOT include subject line, signature, or [placeholders]. Use the actual names provided.
- Output ONLY the message body, ready to send.`;
      const user = `Draft a LinkedIn message to ${item.contactName || 'an ' + contactRole} at ${item.name} requesting a referral for the "${item.role || 'SDE2'}" role.

About the company / fit:
${item.fitNote || `${item.name} — ${item.domain || ''}`}

About the sender:
${profileSummary}`;
      const text = await callClaude(sys, user);
      setOutput(text);
    } catch (e) {
      setError('AI request failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const runFollowUp = async () => {
    setLoading(true); setError(''); setOutput('');
    try {
      const days = item.appliedDate
        ? Math.max(0, Math.floor((Date.now() - new Date(item.appliedDate + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)))
        : 'unknown';
      const sys = `You write brief, professional follow-up messages for job applications. Rules:
- Under 90 words.
- Confident, not desperate. Reaffirm interest concisely.
- Mention one specific thing about why the role/company excites the sender.
- End with a low-friction ask (update, brief chat, or simply "happy to provide more info").
- No subject line, no signature placeholders.
- Output ONLY the message body.`;
      const user = `Draft a follow-up message to ${item.contactName || 'the recruiter'} at ${item.name} about my application for "${item.role || 'SDE2'}".
Application status: ${getStatus(item.status).label}.
Days since applied: ${days}.
Why this company is interesting: ${item.fitNote || item.domain || 'their engineering culture and product'}

About the sender:
${profileSummary}`;
      const text = await callClaude(sys, user);
      setOutput(text);
    } catch (e) {
      setError('AI request failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const runTailor = async () => {
    if (!jdText.trim()) { setError('Paste the job description first.'); return; }
    setLoading(true); setError(''); setOutput('');
    try {
      const sys = `You help software engineers tailor resume bullets to a specific job description. Rules:
- Output 4-6 bullets, each on its own line, prefixed with "• ".
- Each bullet ≤ 25 words, action-verb start, quantified where the sender's experience supports it.
- Match keywords from the JD where authentic — never fabricate experience.
- Emphasize the dimensions of the sender's experience most relevant to THIS JD (e.g. distributed systems if JD asks for that; SaaS scale if JD emphasizes that).
- Mark any bullet where you had to guess specifics with [verify] at the end so the sender can confirm.
- Output ONLY the bullets. No commentary, no intro, no closing.`;
      const user = `Target role: ${item.role || 'SDE2'} at ${item.name} (${item.domain || ''})

Job description:
${jdText}

Sender's background:
${profileSummary}

Sender's existing resume bullets / achievements (if any):
${profile.resumeBullets || '(none provided — generate from background above and mark with [verify])'}`;
      const text = await callClaude(sys, user);
      setOutput(text);
    } catch (e) {
      setError('AI request failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleActionClick = (action) => {
    if (activeAction === action) {
      setActiveAction(null);
      setOutput(''); setError('');
    } else {
      setActiveAction(action);
      setOutput(''); setError('');
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-stone-500 font-mono mb-2 leading-relaxed">
        Generates personalized drafts using your profile. Edit your profile in the header to improve outputs.
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => handleActionClick('referral')}
          className={`flex flex-col items-center gap-1 px-2 py-3 border rounded-sm transition-all ${
            activeAction === 'referral'
              ? 'border-amber-500 bg-amber-500/10 text-amber-300'
              : 'border-stone-700 text-stone-400 hover:border-stone-600'
          }`}>
          <Users size={16} />
          <span className="text-[10px] font-mono">Referral request</span>
        </button>
        <button onClick={() => handleActionClick('followup')}
          className={`flex flex-col items-center gap-1 px-2 py-3 border rounded-sm transition-all ${
            activeAction === 'followup'
              ? 'border-amber-500 bg-amber-500/10 text-amber-300'
              : 'border-stone-700 text-stone-400 hover:border-stone-600'
          }`}>
          <Mail size={16} />
          <span className="text-[10px] font-mono">Follow-up</span>
        </button>
        <button onClick={() => handleActionClick('tailor')}
          className={`flex flex-col items-center gap-1 px-2 py-3 border rounded-sm transition-all ${
            activeAction === 'tailor'
              ? 'border-amber-500 bg-amber-500/10 text-amber-300'
              : 'border-stone-700 text-stone-400 hover:border-stone-600'
          }`}>
          <FileEdit size={16} />
          <span className="text-[10px] font-mono">Tailor resume</span>
        </button>
      </div>

      {activeAction && (
        <div className="border border-stone-800 bg-stone-950/60 rounded-sm p-3 space-y-2.5">
          {activeAction === 'referral' && (
            <>
              <div className="text-[11px] text-stone-400 font-mono">
                Draft a referral request to{' '}
                <span className="text-stone-200">{item.contactName || 'an employee'}</span>{' '}
                at <span className="text-amber-400">{item.name}</span>.
              </div>
              {!item.contactName && (
                <input value={contactRole} onChange={e => setContactRole(e.target.value)}
                  className="input text-xs" placeholder="Who? e.g. engineering manager, senior SDE" />
              )}
              <button onClick={runReferral} disabled={loading}
                className="w-full px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 text-xs font-medium rounded-sm flex items-center justify-center gap-1.5">
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {loading ? 'Generating...' : 'Generate'}
              </button>
            </>
          )}

          {activeAction === 'followup' && (
            <>
              <div className="text-[11px] text-stone-400 font-mono">
                Follow-up for <span className="text-amber-400">{item.name}</span>
                {item.appliedDate && <> · applied {fmtDate(item.appliedDate)}</>}
              </div>
              <button onClick={runFollowUp} disabled={loading}
                className="w-full px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 text-xs font-medium rounded-sm flex items-center justify-center gap-1.5">
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {loading ? 'Generating...' : 'Generate'}
              </button>
            </>
          )}

          {activeAction === 'tailor' && (
            <>
              <div className="text-[11px] text-stone-400 font-mono">
                Paste the job description below; AI generates tailored bullets.
              </div>
              <textarea value={jdText} onChange={e => setJdText(e.target.value)}
                className="input text-xs min-h-[100px] font-mono" rows={5}
                placeholder="Paste full JD here..." />
              <button onClick={runTailor} disabled={loading || !jdText.trim()}
                className="w-full px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-stone-950 text-xs font-medium rounded-sm flex items-center justify-center gap-1.5">
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {loading ? 'Generating...' : 'Generate tailored bullets'}
              </button>
            </>
          )}

          {error && (
            <div className="text-[11px] text-rose-400 font-mono flex items-center gap-1.5">
              <AlertCircle size={11} /> {error}
            </div>
          )}

          {output && (
            <div className="border-t border-stone-800 pt-2.5 mt-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-stone-500 font-mono uppercase tracking-wider">Draft</span>
                <button onClick={handleCopy}
                  className="text-[10px] text-stone-400 hover:text-amber-400 font-mono flex items-center gap-1">
                  <Copy size={11} /> {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="text-xs text-stone-200 whitespace-pre-wrap font-sans leading-relaxed bg-stone-900/60 p-2.5 rounded-sm border border-stone-800/60">
                {output}
              </div>
              <div className="text-[10px] text-stone-600 font-mono mt-1.5 italic">
                AI-generated. Always review and edit before sending.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Sync Indicator (header pill) =====
function SyncIndicator({ state, onClick }) {
  const variants = {
    not_configured: {
      icon: <CloudOff size={12} />,
      label: 'Sync off',
      hover: 'Set up cross-device sync',
      color: 'text-stone-500 hover:text-stone-300 border-stone-800 hover:border-stone-600',
    },
    idle: {
      icon: <Cloud size={12} />,
      label: 'Idle',
      hover: 'Sync',
      color: 'text-stone-400 hover:text-stone-200 border-stone-800',
    },
    syncing: {
      icon: <Loader2 size={12} className="animate-spin" />,
      label: 'Syncing…',
      hover: 'Syncing to GitHub gist',
      color: 'text-sky-400 border-sky-700/40',
    },
    synced: {
      icon: <CheckCircle2 size={12} />,
      label: 'Synced',
      hover: state.lastSync ? `Last synced ${new Date(state.lastSync).toLocaleTimeString()}` : 'Synced',
      color: 'text-emerald-400 hover:text-emerald-300 border-emerald-700/40 hover:border-emerald-600/60',
    },
    error: {
      icon: <AlertCircle size={12} />,
      label: 'Sync error',
      hover: state.error || 'Sync error — click for details',
      color: 'text-rose-400 hover:text-rose-300 border-rose-700/40',
    },
  };
  const v = variants[state.status] || variants.idle;
  return (
    <button onClick={onClick} title={v.hover}
      className={`px-2 py-1.5 border rounded-sm text-[10px] font-mono flex items-center gap-1.5 transition-colors ${v.color}`}>
      {v.icon}
      <span>{v.label}</span>
    </button>
  );
}

// ===== Sync Setup Modal =====
function SyncSetup({ config, currentItems, currentProfile, onClose, onConfigured, onDisconnect }) {
  const isConnected = !!(config?.pat && config?.gistId);
  const [step, setStep] = useState(isConnected ? 'connected' : 'pat');
  const [pat, setPat] = useState(config?.pat || '');
  const [gistId, setGistId] = useState(config?.gistId || '');
  const [mode, setMode] = useState('create'); // 'create' | 'existing'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [user, setUser] = useState(null);
  const [existingGistData, setExistingGistData] = useState(null);
  const [showPat, setShowPat] = useState(false);

  const verifyPat = async () => {
    setBusy(true); setError('');
    try {
      const u = await ghValidatePat(pat);
      setUser(u);
      setStep('choose');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    setBusy(true); setError('');
    try {
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        items: currentItems || [],
        profile: currentProfile || null,
      };
      const gist = await ghCreateGist(pat, payload);
      const newConfig = {
        pat,
        gistId: gist.id,
        gistUrl: gist.html_url,
        login: user?.login,
        connectedAt: new Date().toISOString(),
      };
      await onConfigured(newConfig, { items: currentItems, profile: currentProfile });
      setStep('connected');
      setInfo(`Connected! Created new gist with ${currentItems?.length || 0} companies.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleConnectExisting = async () => {
    if (!gistId.trim()) { setError('Enter a gist ID first'); return; }
    setBusy(true); setError('');
    try {
      const { data, htmlUrl } = await ghReadGist(pat, gistId.trim());
      // Show user what's in the gist and let them choose
      setExistingGistData({ data, htmlUrl, gistId: gistId.trim() });
      setStep('resolve');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const resolvePull = async () => {
    setBusy(true); setError('');
    try {
      const newConfig = {
        pat,
        gistId: existingGistData.gistId,
        gistUrl: existingGistData.htmlUrl,
        login: user?.login,
        connectedAt: new Date().toISOString(),
      };
      await onConfigured(newConfig, existingGistData.data);
      setStep('connected');
      setInfo('Connected! Pulled data from gist into this device.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const resolvePush = async () => {
    setBusy(true); setError('');
    try {
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        items: currentItems || [],
        profile: currentProfile || null,
      };
      await ghWriteGist(pat, existingGistData.gistId, payload);
      const newConfig = {
        pat,
        gistId: existingGistData.gistId,
        gistUrl: existingGistData.htmlUrl,
        login: user?.login,
        connectedAt: new Date().toISOString(),
      };
      await onConfigured(newConfig, { items: currentItems, profile: currentProfile });
      setStep('connected');
      setInfo('Connected! Overwrote gist with local data.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect sync? Your data stays locally on this device. You can reconnect anytime.')) return;
    await onDisconnect();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-xl bg-stone-950 border-l border-stone-800 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-stone-950/95 backdrop-blur border-b border-stone-800 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-amber-500/80 font-mono flex items-center gap-1.5">
              <Github size={11} /> GitHub Gist Sync
            </div>
            <h2 className="font-serif text-2xl text-stone-100 mt-0.5">Cross-device sync</h2>
            <p className="text-[11px] text-stone-500 font-mono mt-0.5">
              Sync your tracker data to a private GitHub Gist. Free, versioned, yours.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-900 rounded text-stone-400 hover:text-stone-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Connected view */}
          {step === 'connected' && (
            <>
              <div className="border border-emerald-700/40 bg-emerald-900/15 rounded-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="text-emerald-400" size={16} />
                  <span className="font-mono text-sm text-emerald-300">Connected</span>
                </div>
                {info && <p className="text-[11px] text-emerald-200/80 font-mono mb-2">{info}</p>}
                <div className="text-xs text-stone-300 space-y-1 font-mono">
                  {config?.login && <div>Account: <span className="text-stone-100">{config.login}</span></div>}
                  <div>Gist ID: <span className="text-stone-100 break-all">{config?.gistId}</span></div>
                  {config?.connectedAt && (
                    <div>Connected: <span className="text-stone-100">{fmtDate(config.connectedAt.slice(0, 10))}</span></div>
                  )}
                </div>
                {config?.gistUrl && (
                  <a href={config.gistUrl} target="_blank" rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-mono">
                    <ExternalLink size={11} /> View gist on GitHub
                  </a>
                )}
              </div>
              <div className="text-[11px] text-stone-500 font-mono leading-relaxed">
                Every change you make on any device pushes to this gist after ~2 seconds. When you open the app, the latest data is pulled. GitHub keeps revision history automatically — every save is a recoverable version.
              </div>
              <button onClick={handleDisconnect}
                className="w-full px-3 py-2 border border-rose-700/40 text-rose-400 hover:bg-rose-900/15 text-xs font-mono rounded-sm flex items-center justify-center gap-1.5">
                <CloudOff size={12} /> Disconnect sync
              </button>
            </>
          )}

          {/* Step 1: PAT entry */}
          {step === 'pat' && (
            <>
              <div className="space-y-3">
                <div className="border border-amber-700/30 bg-amber-900/10 rounded-sm p-3">
                  <div className="text-[11px] text-amber-300 font-mono font-medium mb-2 flex items-center gap-1.5">
                    <Key size={11} /> Step 1 — Create a Personal Access Token
                  </div>
                  <ol className="text-[11px] text-stone-300 space-y-1 font-mono pl-4 list-decimal">
                    <li>Go to <a href="https://github.com/settings/tokens/new?scopes=gist&description=Job%20Tracker%20Sync" target="_blank" rel="noreferrer" className="text-amber-400 underline">github.com/settings/tokens/new <ExternalLink size={9} className="inline" /></a> (pre-filled with gist scope)</li>
                    <li>Set expiration to "No expiration" (or 1 year)</li>
                    <li>Confirm only "gist" scope is checked</li>
                    <li>Click "Generate token", copy it, paste below</li>
                  </ol>
                </div>
                <Field label="Personal Access Token">
                  <div className="relative">
                    <input
                      type={showPat ? 'text' : 'password'}
                      value={pat}
                      onChange={e => setPat(e.target.value)}
                      placeholder="ghp_..."
                      className="input pr-10 font-mono text-xs"
                      autoFocus
                    />
                    <button onClick={() => setShowPat(!showPat)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300">
                      <Eye size={14} />
                    </button>
                  </div>
                </Field>
                <div className="text-[10px] text-stone-500 font-mono leading-relaxed flex gap-1.5">
                  <Shield size={11} className="flex-shrink-0 mt-0.5" />
                  <span>PAT is stored locally on this device only (never written to the gist itself). Only has "gist" scope — can't touch your other GitHub data.</span>
                </div>
                <button onClick={verifyPat} disabled={!pat.trim() || busy}
                  className="w-full px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-stone-950 text-sm font-medium rounded-sm flex items-center justify-center gap-1.5">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
                  Verify token
                </button>
              </div>
            </>
          )}

          {/* Step 2: Choose create or existing */}
          {step === 'choose' && (
            <>
              <div className="border border-emerald-700/30 bg-emerald-900/10 rounded-sm p-3 text-[11px] font-mono">
                <div className="flex items-center gap-1.5 text-emerald-300">
                  <CheckCircle2 size={12} /> Token verified as <span className="text-emerald-200 font-medium">{user?.login}</span>
                </div>
              </div>
              <div className="text-[11px] text-stone-400 font-mono">Step 2 — Choose what to do:</div>
              <div className="space-y-2">
                <button onClick={() => setMode('create')}
                  className={`w-full text-left p-3 border rounded-sm transition-all ${
                    mode === 'create' ? 'border-amber-500 bg-amber-500/10' : 'border-stone-700 hover:border-stone-600'
                  }`}>
                  <div className="font-mono text-sm text-stone-100 flex items-center gap-1.5">
                    <CloudUpload size={13} /> Create new gist
                  </div>
                  <div className="text-[11px] text-stone-500 mt-1 font-mono">
                    Recommended for first-time setup. Creates a private gist with your current {currentItems?.length || 0} companies.
                  </div>
                </button>
                <button onClick={() => setMode('existing')}
                  className={`w-full text-left p-3 border rounded-sm transition-all ${
                    mode === 'existing' ? 'border-amber-500 bg-amber-500/10' : 'border-stone-700 hover:border-stone-600'
                  }`}>
                  <div className="font-mono text-sm text-stone-100 flex items-center gap-1.5">
                    <Cloud size={13} /> Use existing gist
                  </div>
                  <div className="text-[11px] text-stone-500 mt-1 font-mono">
                    For connecting a second device. Paste the gist ID from your first device's Sync screen.
                  </div>
                </button>
              </div>

              {mode === 'existing' && (
                <Field label="Gist ID">
                  <input value={gistId} onChange={e => setGistId(e.target.value)}
                    className="input text-xs font-mono"
                    placeholder="e.g. a1b2c3d4e5f6..." />
                </Field>
              )}

              <button
                onClick={mode === 'create' ? handleCreate : handleConnectExisting}
                disabled={busy || (mode === 'existing' && !gistId.trim())}
                className="w-full px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-stone-950 text-sm font-medium rounded-sm flex items-center justify-center gap-1.5">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
                {mode === 'create' ? 'Create and connect' : 'Verify gist'}
              </button>
              <button onClick={() => setStep('pat')} className="text-[11px] text-stone-500 hover:text-stone-300 font-mono">
                ← Back
              </button>
            </>
          )}

          {/* Step 3: Resolve conflict for existing gist */}
          {step === 'resolve' && existingGistData && (
            <>
              <div className="border border-amber-700/30 bg-amber-900/10 rounded-sm p-3 text-[11px] font-mono space-y-1">
                <div className="text-amber-300 font-medium">Gist found. Pick which data wins:</div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="text-stone-400">
                    <div className="text-stone-500 text-[10px] uppercase tracking-wider mb-0.5">In the gist</div>
                    <div className="text-stone-100">{existingGistData.data?.items?.length || 0} companies</div>
                    {existingGistData.data?.savedAt && (
                      <div className="text-[10px] text-stone-500 mt-0.5">saved {fmtDate(existingGistData.data.savedAt.slice(0, 10))}</div>
                    )}
                  </div>
                  <div className="text-stone-400">
                    <div className="text-stone-500 text-[10px] uppercase tracking-wider mb-0.5">On this device</div>
                    <div className="text-stone-100">{currentItems?.length || 0} companies</div>
                  </div>
                </div>
              </div>
              <button onClick={resolvePull} disabled={busy}
                className="w-full px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-stone-950 text-sm font-medium rounded-sm flex items-center justify-center gap-1.5">
                <Download size={13} /> Pull gist data here (overwrites local)
              </button>
              <button onClick={resolvePush} disabled={busy}
                className="w-full px-3 py-2 border border-stone-700 hover:border-stone-500 text-stone-300 text-sm font-mono rounded-sm flex items-center justify-center gap-1.5">
                <Upload size={13} /> Push local data to gist (overwrites gist)
              </button>
              <button onClick={() => setStep('choose')} className="text-[11px] text-stone-500 hover:text-stone-300 font-mono">
                ← Back
              </button>
            </>
          )}

          {error && (
            <div className="border border-rose-700/40 bg-rose-900/15 rounded-sm p-2.5 text-[11px] text-rose-300 font-mono flex items-start gap-1.5">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Profile Editor =====
function ProfileEditor({ profile, onClose, onSave }) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => { setDraft(profile); }, [profile]);
  if (!draft) return null;
  const update = (patch) => setDraft(d => ({ ...d, ...patch }));

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-xl bg-stone-950 border-l border-stone-800 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-stone-950/95 backdrop-blur border-b border-stone-800 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-amber-500/80 font-mono">Profile</div>
            <h2 className="font-serif text-2xl text-stone-100 mt-0.5">Your profile</h2>
            <p className="text-[11px] text-stone-500 font-mono mt-0.5">
              Used by AI Co-pilot to personalize drafts. Stays on your device.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-900 rounded text-stone-400 hover:text-stone-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-3">
          <Field label="Full name">
            <input value={draft.name} onChange={e => update({ name: e.target.value })} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current role">
              <input value={draft.currentRole} onChange={e => update({ currentRole: e.target.value })} className="input" placeholder="SDE2" />
            </Field>
            <Field label="Current company">
              <input value={draft.currentCompany} onChange={e => update({ currentCompany: e.target.value })} className="input" placeholder="Intuit" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Years of experience">
              <input value={draft.yearsExp} onChange={e => update({ yearsExp: e.target.value })} className="input" placeholder="2.5" />
            </Field>
            <Field label="Education">
              <input value={draft.education} onChange={e => update({ education: e.target.value })} className="input" placeholder="NIT Trichy, 2023" />
            </Field>
          </div>
          <Field label="Tech stack">
            <input value={draft.techStack} onChange={e => update({ techStack: e.target.value })} className="input"
              placeholder="Java, Spring Boot, distributed systems..." />
          </Field>
          <Field label="Domain experience">
            <input value={draft.domain} onChange={e => update({ domain: e.target.value })} className="input"
              placeholder="Fintech SaaS, QuickBooks platform..." />
          </Field>
          <Field label="Notable achievements (for AI context)">
            <textarea value={draft.achievements} onChange={e => update({ achievements: e.target.value })}
              className="input min-h-[80px]" rows={4}
              placeholder="e.g. Led migration of X service from monolith to microservices, reducing p99 latency by 40%..." />
          </Field>
          <Field label="Resume bullets (raw — for tailoring)">
            <textarea value={draft.resumeBullets} onChange={e => update({ resumeBullets: e.target.value })}
              className="input min-h-[150px] font-mono text-xs" rows={8}
              placeholder="Paste your existing resume bullets here. AI uses these as the source material when tailoring to specific JDs." />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-stone-950/95 backdrop-blur border-t border-stone-800 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-400 hover:text-stone-200">Cancel</button>
          <button onClick={() => { onSave(draft); onClose(); }}
            className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-400 text-stone-950 font-medium rounded-sm flex items-center gap-1.5">
            <Save size={14} /> Save profile
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Main App =====
export default function App() {
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [trackTab, setTrackTab] = useState('primary');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'board'
  const [profile, setProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [gistConfig, setGistConfig] = useState(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncState, setSyncState] = useState({ status: 'idle', lastSync: null, error: null });
  // 'idle' | 'syncing' | 'synced' | 'error' | 'not_configured'
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTier, setFilterTier] = useState('all');
  const [sortBy, setSortBy] = useState('tier');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  // Init — load local cache first (instant render), then pull from gist if configured
  useEffect(() => {
    (async () => {
      const stored = await loadStore();
      const storedProfile = await loadProfile();
      const cfg = await loadGistConfig();
      setGistConfig(cfg);

      // Build initial state from local cache
      let initialItems = null;
      let initialProfile = storedProfile || DEFAULT_PROFILE;

      if (stored && Array.isArray(stored.items)) {
        let migrated = stored.items.map(i => ({
          ...i,
          track: i.track || 'primary',
          rounds: Array.isArray(i.rounds) ? i.rounds : [],
        }));
        const existingNames = new Set(migrated.map(i => i.name.toLowerCase()));

        if (!stored.secondaryAdded) {
          const newSecondary = SEED
            .filter(s => s.track === 'secondary' && !existingNames.has(s.name.toLowerCase()))
            .map(normalize);
          migrated = [...migrated, ...newSecondary];
          newSecondary.forEach(s => existingNames.add(s.name.toLowerCase()));
        }

        if (!stored.startupsAdded) {
          const newStartups = SEED
            .filter(s => s.track === 'startup' && !existingNames.has(s.name.toLowerCase()))
            .map(normalize);
          migrated = [...migrated, ...newStartups];
        }

        initialItems = migrated;
      } else {
        initialItems = SEED.map(normalize);
        await saveStore({ items: initialItems, secondaryAdded: true, startupsAdded: true });
      }

      // Set initial state from cache so UI renders immediately
      setItems(initialItems);
      setProfile(initialProfile);

      // If gist is configured, pull fresh data and override
      if (cfg?.pat && cfg?.gistId) {
        setSyncState({ status: 'syncing', lastSync: null, error: null });
        try {
          const { data } = await ghReadGist(cfg.pat, cfg.gistId);
          if (data?.items && Array.isArray(data.items)) {
            const refreshed = data.items.map(i => ({
              ...i,
              track: i.track || 'primary',
              rounds: Array.isArray(i.rounds) ? i.rounds : [],
            }));
            setItems(refreshed);
            await saveStore({ items: refreshed, secondaryAdded: true, startupsAdded: true });
          }
          if (data?.profile) {
            setProfile(data.profile);
            await saveProfile(data.profile);
          }
          setSyncState({ status: 'synced', lastSync: new Date().toISOString(), error: null });
        } catch (e) {
          console.error('initial sync failed', e);
          setSyncState({ status: 'error', lastSync: null, error: e.message });
        }
      } else {
        setSyncState({ status: 'not_configured', lastSync: null, error: null });
      }
    })();
  }, []);

  // Persist
  useEffect(() => {
    if (items === null) return;
    (async () => {
      setSaving(true);
      await saveStore({ items, secondaryAdded: true, startupsAdded: true });
      setTimeout(() => setSaving(false), 400);
    })();
  }, [items]);

  // Persist profile
  useEffect(() => {
    if (profile === null) return;
    saveProfile(profile);
  }, [profile]);

  // Debounced gist push (~2s after last change)
  useEffect(() => {
    if (items === null || profile === null) return;
    if (!gistConfig?.pat || !gistConfig?.gistId) return;
    const t = setTimeout(async () => {
      setSyncState(s => ({ ...s, status: 'syncing', error: null }));
      try {
        await ghWriteGist(gistConfig.pat, gistConfig.gistId, {
          version: 1,
          savedAt: new Date().toISOString(),
          items,
          profile,
        });
        setSyncState({ status: 'synced', lastSync: new Date().toISOString(), error: null });
      } catch (e) {
        console.error('gist push failed', e);
        setSyncState(s => ({ status: 'error', lastSync: s.lastSync, error: e.message }));
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [items, profile, gistConfig]);

  // Manual sync trigger
  const handleManualSync = async () => {
    if (!gistConfig?.pat || !gistConfig?.gistId) return;
    setSyncState(s => ({ ...s, status: 'syncing', error: null }));
    try {
      const { data } = await ghReadGist(gistConfig.pat, gistConfig.gistId);
      if (data?.items && Array.isArray(data.items)) {
        const refreshed = data.items.map(i => ({
          ...i,
          track: i.track || 'primary',
          rounds: Array.isArray(i.rounds) ? i.rounds : [],
        }));
        setItems(refreshed);
      }
      if (data?.profile) setProfile(data.profile);
      setSyncState({ status: 'synced', lastSync: new Date().toISOString(), error: null });
    } catch (e) {
      setSyncState(s => ({ status: 'error', lastSync: s.lastSync, error: e.message }));
    }
  };

  // Sync setup handlers
  const handleSyncConfigured = async (newConfig, initialData) => {
    await saveGistConfig(newConfig);
    setGistConfig(newConfig);
    if (initialData?.items) {
      const refreshed = initialData.items.map(i => ({
        ...i,
        track: i.track || 'primary',
        rounds: Array.isArray(i.rounds) ? i.rounds : [],
      }));
      setItems(refreshed);
    }
    if (initialData?.profile) setProfile(initialData.profile);
    setSyncState({ status: 'synced', lastSync: new Date().toISOString(), error: null });
  };

  const handleSyncDisconnect = async () => {
    await clearGistConfig();
    setGistConfig(null);
    setSyncState({ status: 'not_configured', lastSync: null, error: null });
  };

  const stats = useMemo(() => {
    if (!items) return null;
    const scope = trackTab === 'all' ? items : items.filter(i => (i.track || 'primary') === trackTab);
    const by = (id) => scope.filter(i => i.status === id).length;
    return {
      total: scope.length,
      not_applied: by('not_applied'),
      applied: by('applied') + by('referral'),
      in_progress: by('oa') + by('interview'),
      offers: by('offer'),
      rejected: by('rejected') + by('ghosted'),
    };
  }, [items, trackTab]);

  const filtered = useMemo(() => {
    if (!items) return [];
    let r = trackTab === 'all' ? items : items.filter(i => (i.track || 'primary') === trackTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.role.toLowerCase().includes(q) ||
        i.domain.toLowerCase().includes(q) ||
        (i.locations || []).some(l => l.toLowerCase().includes(q)) ||
        (i.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (filterStatus !== 'all') r = r.filter(i => i.status === filterStatus);
    if (filterTier !== 'all') r = r.filter(i => i.tier === parseInt(filterTier));

    r = [...r].sort((a, b) => {
      if (sortBy === 'tier') return (b.tier - a.tier) || a.name.localeCompare(b.name);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'status') return a.status.localeCompare(b.status);
      if (sortBy === 'applied') {
        const ad = a.appliedDate || '0', bd = b.appliedDate || '0';
        return bd.localeCompare(ad);
      }
      return 0;
    });
    return r;
  }, [items, search, filterStatus, filterTier, sortBy, trackTab]);

  const onSave = (draft) => {
    setItems(prev => {
      const exists = prev.find(i => i.id === draft.id);
      if (exists) return prev.map(i => i.id === draft.id ? draft : i);
      return [...prev, draft];
    });
    setEditing(null);
  };
  const onDelete = (id) => {
    if (!confirm('Delete this entry?')) return;
    setItems(prev => prev.filter(i => i.id !== id));
    setEditing(null);
  };
  const openNew = () => {
    setEditing({
      id: newId(), name: '', tier: 3,
      track: trackTab === 'all' ? 'primary' : (trackTab === 'startup' ? 'startup' : trackTab),
      locations: [], role: '', domain: '',
      fitNote: '', careersUrl: '', compLink: '', tags: [],
      status: 'not_applied', jobLink: '', resumeVersion: '',
      contactName: '', contactInfo: '', appliedDate: '', followUpDate: '',
      notes: '', referralAsked: false, rounds: [], createdAt: Date.now(),
    });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ items }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `job-tracker-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        if (parsed.items && Array.isArray(parsed.items)) {
          if (confirm(`Replace current ${items.length} entries with ${parsed.items.length} from file?`)) {
            setItems(parsed.items);
          }
        }
      } catch { alert('Invalid file'); }
    };
    r.readAsText(f);
    e.target.value = '';
  };
  const resetSeed = () => {
    if (!confirm('Reset to default company list? This will erase your tracking data.')) return;
    setItems(SEED.map(normalize));
  };

  if (items === null) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center text-stone-500">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=JetBrains+Mono:wght@400;500&family=Geist:wght@300;400;500;600&display=swap');
        body, .font-sans { font-family: 'Geist', system-ui, sans-serif; }
        .font-serif { font-family: 'Fraunces', Georgia, serif; font-feature-settings: 'ss01'; }
        .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        .input {
          width: 100%;
          background: rgba(20,18,16,0.6);
          border: 1px solid #2a2723;
          color: #e8e3dc;
          padding: 8px 10px;
          font-size: 13px;
          font-family: 'Geist', system-ui, sans-serif;
          border-radius: 2px;
          outline: none;
          transition: border-color 0.15s;
        }
        .input:focus { border-color: #d4a574; }
        .link-pill {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 10px;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          color: #c4b8a8;
          background: rgba(40,35,28,0.5);
          border: 1px solid #3a342b;
          border-radius: 2px;
          transition: all 0.15s;
        }
        .link-pill:hover { color: #f0e6d4; border-color: #d4a574; background: rgba(60,48,32,0.5); }
        .grain::before {
          content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 1;
          opacity: 0.035;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' /%3E%3C/svg%3E");
        }
      `}</style>

      <div className="grain">
        {/* Header */}
        <header className="border-b border-stone-800 bg-stone-950/80 backdrop-blur sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-6 py-5">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 font-mono mb-1">
                  Personal · Job Hunt
                </div>
                <h1 className="font-serif text-4xl text-stone-100 leading-none">
                  Himanshu's <em className="text-amber-400/90">Tracker</em>
                </h1>
                <p className="text-sm text-stone-500 mt-1.5 font-mono">
                  SDE2 @ Intuit → next move · 70 LPA+ targets
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SyncIndicator state={syncState} onClick={() => setSyncOpen(true)} />
                <span className={`text-[10px] font-mono text-stone-500 transition-opacity ${saving ? 'opacity-100' : 'opacity-0'}`}>
                  cached
                </span>
                <button onClick={() => setProfileOpen(true)} title="Edit profile (for AI Co-pilot)"
                  className="p-2 border border-stone-800 hover:border-amber-700/60 text-stone-400 hover:text-amber-400 rounded-sm">
                  <User size={14} />
                </button>
                <button onClick={exportJson} title="Export"
                  className="p-2 border border-stone-800 hover:border-amber-700/60 text-stone-400 hover:text-amber-400 rounded-sm">
                  <Download size={14} />
                </button>
                <button onClick={() => fileRef.current?.click()} title="Import"
                  className="p-2 border border-stone-800 hover:border-amber-700/60 text-stone-400 hover:text-amber-400 rounded-sm">
                  <Upload size={14} />
                </button>
                <input ref={fileRef} type="file" accept=".json" hidden onChange={importJson} />
                <button onClick={openNew}
                  className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-medium text-sm rounded-sm flex items-center gap-1.5">
                  <Plus size={14} /> Add company
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              <StatBox label="Total" value={stats.total} hint="tracked" />
              <StatBox label="Not yet" value={stats.not_applied} hint="to apply" />
              <StatBox label="Applied" value={stats.applied} hint="in queue" />
              <StatBox label="In progress" value={stats.in_progress} hint="OA / interview" />
              <StatBox label="Offers" value={stats.offers} hint="received" />
              <StatBox label="Closed" value={stats.rejected} hint="rejected / ghosted" />
            </div>
          </div>
        </header>

        {/* Track tabs */}
        <div className="border-b border-stone-800/60 bg-stone-950/40">
          <div className="max-w-6xl mx-auto px-6 flex items-end gap-1 overflow-x-auto">
            {[
              { id: 'primary',   label: 'Primary targets',   sub: '70 LPA+ goal',           accent: 'amber' },
              { id: 'secondary', label: 'Secondary · Warmup', sub: 'practice + backup',     accent: 'stone' },
              { id: 'startup',   label: 'Startups',          sub: 'ESOP upside + ownership', accent: 'emerald' },
              { id: 'all',       label: 'All',               sub: '',                       accent: 'amber' },
            ].map(t => {
              const count = t.id === 'all'
                ? items.length
                : items.filter(i => (i.track || 'primary') === t.id).length;
              const active = trackTab === t.id;
              const activeColor = t.accent === 'emerald'
                ? { text: 'text-emerald-400', bar: 'bg-emerald-400', sub: 'text-emerald-500/60', count: 'text-emerald-500/70' }
                : t.accent === 'stone'
                ? { text: 'text-stone-200', bar: 'bg-stone-300', sub: 'text-stone-400/70', count: 'text-stone-400/70' }
                : { text: 'text-amber-400', bar: 'bg-amber-400', sub: 'text-amber-500/60', count: 'text-amber-500/70' };
              return (
                <button key={t.id} onClick={() => setTrackTab(t.id)}
                  className={`relative px-4 py-3 text-left transition-colors whitespace-nowrap ${
                    active ? activeColor.text : 'text-stone-500 hover:text-stone-300'
                  }`}>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm">{t.label}</span>
                    <span className={`font-mono text-xs ${active ? activeColor.count : 'text-stone-600'}`}>{count}</span>
                  </div>
                  {t.sub && (
                    <div className={`text-[10px] font-mono mt-0.5 ${active ? activeColor.sub : 'text-stone-600'}`}>
                      {t.sub}
                    </div>
                  )}
                  {active && (
                    <span className={`absolute left-0 right-0 -bottom-px h-0.5 ${activeColor.bar}`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filter bar */}
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center gap-2 border-b border-stone-800/60">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search company, role, domain, location..."
              className="w-full pl-9 pr-3 py-2 bg-stone-900/60 border border-stone-800 focus:border-amber-700/60 outline-none text-sm rounded-sm font-sans"
            />
          </div>

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-stone-900/60 border border-stone-800 text-sm rounded-sm font-mono text-stone-300">
            <option value="all">All statuses</option>
            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          <select value={filterTier} onChange={e => setFilterTier(e.target.value)}
            className="px-3 py-2 bg-stone-900/60 border border-stone-800 text-sm rounded-sm font-mono text-stone-300">
            <option value="all">All fits</option>
            <option value="5">★★★★★ Excellent</option>
            <option value="4">★★★★ Strong</option>
            <option value="3">★★★ Good</option>
            <option value="2">★★ Decent</option>
          </select>

          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="px-3 py-2 bg-stone-900/60 border border-stone-800 text-sm rounded-sm font-mono text-stone-300">
            <option value="tier">Sort: Best fit first</option>
            <option value="name">Sort: A → Z</option>
            <option value="status">Sort: By status</option>
            <option value="applied">Sort: Recently applied</option>
          </select>

          {/* View mode toggle */}
          <div className="inline-flex border border-stone-800 rounded-sm overflow-hidden">
            <button onClick={() => setViewMode('list')}
              className={`px-2.5 py-2 text-xs font-mono flex items-center gap-1.5 transition-colors ${
                viewMode === 'list' ? 'bg-amber-500/15 text-amber-400' : 'text-stone-500 hover:text-stone-300'
              }`}>
              <ListIcon size={13} /> List
            </button>
            <button onClick={() => setViewMode('board')}
              className={`px-2.5 py-2 text-xs font-mono flex items-center gap-1.5 transition-colors border-l border-stone-800 ${
                viewMode === 'board' ? 'bg-amber-500/15 text-amber-400' : 'text-stone-500 hover:text-stone-300'
              }`}>
              <LayoutGrid size={13} /> Board
            </button>
          </div>

          <button onClick={resetSeed} title="Reset to default company list"
            className="px-3 py-2 text-xs text-stone-500 hover:text-stone-300 font-mono">
            reset
          </button>
        </div>

        {/* Content */}
        <main className={`mx-auto px-6 py-6 relative z-10 ${viewMode === 'board' ? 'max-w-[1800px]' : 'max-w-6xl'}`}>
          {filtered.length === 0 ? (
            <div className="text-center py-20 text-stone-500">
              <AlertCircle className="mx-auto mb-3 opacity-50" size={32} />
              <p className="text-sm">No companies match your filters.</p>
            </div>
          ) : viewMode === 'board' ? (
            <>
              <div className="flex items-center justify-between mb-3 text-xs text-stone-500 font-mono">
                <span>{filtered.length} {filtered.length === 1 ? 'company' : 'companies'} on board</span>
                <span className="flex items-center gap-1.5">
                  <GripVertical size={11} /> drag cards between columns to update status
                </span>
              </div>
              <BoardView
                items={filtered}
                onOpen={setEditing}
                onStatusChange={(id, newStatus) => {
                  setItems(prev => prev.map(i => i.id === id ? { ...i, status: newStatus } : i));
                }}
              />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 text-xs text-stone-500 font-mono">
                <span>{filtered.length} {filtered.length === 1 ? 'company' : 'companies'}</span>
                <span className="flex items-center gap-1.5">
                  <Eye size={11} /> click any card to edit
                </span>
              </div>
              <div className="grid gap-2">
                {filtered.map(item => (
                  <CompanyCard key={item.id} item={item} onOpen={setEditing} showTrack={trackTab === 'all'} />
                ))}
              </div>
            </>
          )}
        </main>

        <footer className="max-w-6xl mx-auto px-6 py-8 text-center text-[11px] text-stone-600 font-mono border-t border-stone-800/60 mt-12">
          <p>
            {gistConfig?.gistId
              ? <>Synced to a private GitHub Gist · revision history preserved automatically</>
              : <>Data cached on this device · click "Sync off" in header to enable cross-device sync</>}
          </p>
          <p className="mt-1">Curated for: NIT Trichy '23 · Java/Spring · Distributed systems · Backend platform</p>
        </footer>

        {editing && (
          <DetailPanel
            item={editing}
            profile={profile}
            onClose={() => setEditing(null)}
            onSave={onSave}
            onDelete={onDelete}
          />
        )}

        {profileOpen && profile && (
          <ProfileEditor
            profile={profile}
            onClose={() => setProfileOpen(false)}
            onSave={(p) => setProfile(p)}
          />
        )}

        {syncOpen && (
          <SyncSetup
            config={gistConfig}
            currentItems={items}
            currentProfile={profile}
            onClose={() => setSyncOpen(false)}
            onConfigured={handleSyncConfigured}
            onDisconnect={handleSyncDisconnect}
          />
        )}
      </div>
    </div>
  );
}
