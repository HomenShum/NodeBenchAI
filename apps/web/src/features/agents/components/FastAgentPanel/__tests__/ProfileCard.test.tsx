// src/components/FastAgentPanel/__tests__/ProfileCard.test.tsx
// Tests for ProfileCard and ProfileGrid components

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileCard, ProfileGrid } from '../ProfileCard';
import type { PersonProfile } from '../ProfileCard';

describe('ProfileCard', () => {
  const mockProfile: PersonProfile = {
    name: 'Elon Musk',
    profession: 'CEO',
    organization: 'Tesla',
    location: 'Austin, TX',
    description: 'Founder and CEO of Tesla',
    url: 'https://example.com/elon-musk',
  };

  it('should render profile card with name', () => {
    render(<ProfileCard profile={mockProfile} />);
    expect(screen.getByText('Elon Musk')).toBeInTheDocument();
  });

  it('should render profession', () => {
    render(<ProfileCard profile={mockProfile} />);
    expect(screen.getByText('CEO')).toBeInTheDocument();
  });

  it('should render organization', () => {
    render(<ProfileCard profile={mockProfile} />);
    expect(screen.getByText('Tesla')).toBeInTheDocument();
  });

  it('should render location', () => {
    render(<ProfileCard profile={mockProfile} />);
    expect(screen.getByText('Austin, TX')).toBeInTheDocument();
  });

  it('should render description', () => {
    render(<ProfileCard profile={mockProfile} />);
    expect(screen.getByText('Founder and CEO of Tesla')).toBeInTheDocument();
  });

  it('should have scroll-mt-4 class for smooth scrolling', () => {
    const { container } = render(<ProfileCard profile={mockProfile} />);
    const div = container.querySelector('div[id]') || container.firstChild;
    expect((div as any)?.className).toContain('scroll-mt-4');
  });

  it('should show "View Profile" link if URL provided', () => {
    render(<ProfileCard profile={mockProfile} />);
    const link = screen.getByRole('link', { name: /View Profile/i });
    expect(link).toHaveAttribute('href', 'https://example.com/elon-musk');
  });

  it('should show "More" button if additional info provided', () => {
    const profileWithInfo = {
      ...mockProfile,
      additionalInfo: 'Additional information about Elon Musk',
    };
    render(<ProfileCard profile={profileWithInfo} />);
    
    const moreButton = screen.getByRole('button', { name: /More/i });
    expect(moreButton).toBeInTheDocument();
  });

  it('should expand to show additional info when "More" is clicked', () => {
    const profileWithInfo = {
      ...mockProfile,
      additionalInfo: 'Additional information about Elon Musk',
    };
    render(<ProfileCard profile={profileWithInfo} />);
    
    const moreButton = screen.getByRole('button', { name: /More/i });
    fireEvent.click(moreButton);
    
    expect(screen.getByText('Additional information about Elon Musk')).toBeInTheDocument();
  });

  it('should show "Less" button after expanding', () => {
    const profileWithInfo = {
      ...mockProfile,
      additionalInfo: 'Additional information about Elon Musk',
    };
    render(<ProfileCard profile={profileWithInfo} />);
    
    const moreButton = screen.getByRole('button', { name: /More/i });
    fireEvent.click(moreButton);
    
    const lessButton = screen.getByRole('button', { name: /Less/i });
    expect(lessButton).toBeInTheDocument();
  });
});

describe('ProfileGrid', () => {
  const mockProfiles: PersonProfile[] = Array.from({ length: 6 }, (_, i) => ({
    name: `Person ${i + 1}`,
    profession: `Role ${i + 1}`,
    organization: `Company ${i + 1}`,
    location: `City ${i + 1}`,
    description: `Description for person ${i + 1}`,
  }));

  it('should render nothing if no profiles', () => {
    const { container } = render(<ProfileGrid profiles={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should display initial profiles (up to 4)', () => {
    render(<ProfileGrid profiles={mockProfiles} />);
    
    expect(screen.getByText('Person 1')).toBeInTheDocument();
    expect(screen.getByText('Person 4')).toBeInTheDocument();
    expect(screen.queryByText('Person 5')).not.toBeInTheDocument();
  });

  it('should show "Show More" button when profiles exceed 4', () => {
    render(<ProfileGrid profiles={mockProfiles} />);
    
    const showMoreButton = screen.getByRole('button', { name: /Show 2 More/i });
    expect(showMoreButton).toBeInTheDocument();
  });

  it('should show all profiles when "Show More" is clicked', () => {
    render(<ProfileGrid profiles={mockProfiles} />);
    
    const showMoreButton = screen.getByRole('button', { name: /Show 2 More/i });
    fireEvent.click(showMoreButton);
    
    expect(screen.getByText('Person 5')).toBeInTheDocument();
    expect(screen.getByText('Person 6')).toBeInTheDocument();
  });

  it('should show "Show Less" button after expanding', () => {
    render(<ProfileGrid profiles={mockProfiles} />);
    
    const showMoreButton = screen.getByRole('button', { name: /Show 2 More/i });
    fireEvent.click(showMoreButton);
    
    const showLessButton = screen.getByRole('button', { name: /Show Less/i });
    expect(showLessButton).toBeInTheDocument();
  });

  it('does not present found profiles as citations', () => {
    const { container } = render(<ProfileGrid profiles={mockProfiles.slice(0, 3)} />);

    expect(screen.queryAllByText(/^[0-9]$/)).toHaveLength(0);
    expect(container.querySelector('[id^="profile-"]')).toBeNull();
  });

  it('should display correct count in header', () => {
    render(<ProfileGrid profiles={mockProfiles} />);
    
    // Should show "4/6" initially
    expect(screen.getByText(/4\/6/)).toBeInTheDocument();
  });
});
