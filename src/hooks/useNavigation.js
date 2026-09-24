// src/hooks/useNavigation.js
// Optimized navigation hook with settings page support
import { useState, useCallback, useMemo } from 'react';

// Page constants - aligned with app structure
export const PAGE_NAMES = Object.freeze({
  DASHBOARD: 'dashboard',
  SCHEDULE: 'schedule',
  SUBMIT: 'submit',
  USERS: 'users',
  REPORTS: 'reports',
  UPLOADS: 'uploads',
  SETTINGS: 'settings',
  COMPLAINT: 'complaint'
});

/**
 * Navigation hook for managing app navigation state
 */
export const useNavigation = (initialPage = PAGE_NAMES.DASHBOARD) => {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [navigationHistory, setNavigationHistory] = useState([initialPage]);

  // Navigate to a specific page
  const navigateTo = useCallback((page) => {
    if (!page || page === currentPage) return;
    
    setCurrentPage(page);
    setIsMobileMenuOpen(false);
    
    // Update navigation history
    setNavigationHistory(prev => [...prev, page]);
  }, [currentPage]);

  // Navigate back to previous page
  const navigateBack = useCallback(() => {
    if (navigationHistory.length <= 1) {
      navigateTo(PAGE_NAMES.DASHBOARD);
      return;
    }
    
    const newHistory = [...navigationHistory];
    newHistory.pop(); // Remove current page
    const previousPage = newHistory[newHistory.length - 1];
    
    setCurrentPage(previousPage);
    setNavigationHistory(newHistory);
    setIsMobileMenuOpen(false);
  }, [navigationHistory, navigateTo]);

  // Toggle mobile menu
  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(prev => !prev);
  }, []);

  // Close mobile menu
  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
  }, []);

  // Open mobile menu
  const openMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(true);
  }, []);

  // Check if a page is active
  const isActivePage = useCallback((page) => {
    return currentPage === page;
  }, [currentPage]);

  // Get navigation state
  const navigationState = useMemo(() => ({
    currentPage,
    isMobileMenuOpen,
    canGoBack: navigationHistory.length > 1,
    historyLength: navigationHistory.length
  }), [currentPage, isMobileMenuOpen, navigationHistory]);

  return {
    // Current state
    currentPage,
    isMobileMenuOpen,
    navigationHistory,
    
    // Navigation actions
    navigateTo,
    navigateBack,
    toggleMobileMenu,
    closeMobileMenu,
    openMobileMenu,
    
    // Queries
    isActivePage,
    navigationState,
    
    // Constants
    PAGE_NAMES
  };
};

export default useNavigation;