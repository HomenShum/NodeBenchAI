/**
 * Example usage of dossier email template
 * 
 * This file demonstrates how to use the email template generator
 */

import { generateDossierEmail, type DossierEmailData } from './dossierEmailTemplate';

/**
 * Example: Generate a company dossier email
 */
export function generateExampleDossierEmail(): string {
  const exampleData: DossierEmailData = {
    title: 'ACME Corp - Company Dossier',
    
    highlightedQuote: {
      text: 'We\'re building the future of AI-powered productivity tools for modern teams.',
      author: 'Jane Smith, CEO',
    },
    
    companyOverview: {
      name: 'ACME Corp',
      description: 'ACME Corp is a leading provider of AI-powered productivity tools designed to help modern teams collaborate more effectively. Our platform combines cutting-edge machine learning with intuitive design to streamline workflows and boost team performance.',
      headquarters: 'San Francisco, CA',
      website: 'https://acmecorp.com',
      founded: '2020',
      industry: 'Enterprise SaaS',
      employeeCount: '150+',
      stage: 'Series B',
    },
    
    founders: [
      {
        name: 'Jane Smith',
        role: 'Co-Founder & CEO',
        bio: 'Former VP of Product at Google. 15+ years of experience building enterprise software. Stanford CS graduate.',
        linkedin: 'https://linkedin.com/in/janesmith',
        twitter: 'https://twitter.com/janesmith',
      },
      {
        name: 'John Doe',
        role: 'Co-Founder & CTO',
        bio: 'Ex-Principal Engineer at Meta. Led AI infrastructure teams. MIT PhD in Machine Learning.',
        linkedin: 'https://linkedin.com/in/johndoe',
      },
    ],
    
    funding: {
      totalRaised: '$45M',
      latestRound: {
        round: 'Series B',
        amount: '$30M',
        date: 'March 2024',
        investors: ['Sequoia Capital', 'Andreessen Horowitz', 'Y Combinator'],
      },
      rounds: [
        {
          round: 'Series B',
          amount: '$30M',
          date: 'March 2024',
        },
        {
          round: 'Series A',
          amount: '$12M',
          date: 'June 2022',
        },
        {
          round: 'Seed',
          amount: '$3M',
          date: 'January 2021',
        },
      ],
      keyInvestors: ['Sequoia Capital', 'Andreessen Horowitz', 'Y Combinator', 'First Round Capital'],
    },
    
    researchLinks: [
      {
        title: 'ACME Corp Raises $30M Series B to Expand AI Platform',
        url: 'https://techcrunch.com/acme-series-b',
        source: 'TechCrunch',
        date: 'March 15, 2024',
        type: 'news',
        snippet: 'The company plans to use the funding to expand its AI capabilities and grow its enterprise customer base.',
      },
      {
        title: 'How ACME Corp is Revolutionizing Team Collaboration',
        url: 'https://forbes.com/acme-collaboration',
        source: 'Forbes',
        date: 'February 28, 2024',
        type: 'news',
        snippet: 'An in-depth look at how ACME\'s AI-powered tools are changing the way teams work together.',
      },
      {
        title: 'ACME Corp Product Demo - AI Productivity Suite',
        url: 'https://youtube.com/watch?v=example',
        source: 'YouTube',
        date: 'January 10, 2024',
        type: 'video',
        snippet: 'Watch a full walkthrough of ACME\'s latest product features and AI capabilities.',
      },
      {
        title: 'Research Paper: AI-Driven Workflow Optimization',
        url: 'https://arxiv.org/example',
        source: 'arXiv',
        date: 'December 2023',
        type: 'research',
        snippet: 'Academic research on the effectiveness of AI-powered productivity tools in enterprise settings.',
      },
    ],
  };

  return generateDossierEmail(exampleData);
}

/**
 * Example: Generate a minimal dossier email
 */
export function generateMinimalDossierEmail(): string {
  const minimalData: DossierEmailData = {
    title: 'Quick Company Overview',
    
    companyOverview: {
      name: 'StartupXYZ',
      description: 'A promising early-stage startup building innovative solutions in the fintech space.',
      founded: '2023',
      stage: 'Seed',
    },
    
    researchLinks: [
      {
        title: 'StartupXYZ Launches Beta Product',
        url: 'https://example.com/news',
        source: 'TechNews',
        date: 'April 2024',
        type: 'news',
      },
    ],
  };

  return generateDossierEmail(minimalData);
}

