"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";

export interface SearchContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
}

const defaultContext: SearchContextType = {
  searchQuery: "",
  setSearchQuery: () => {},
  clearSearch: () => {},
};

const SearchContext = createContext<SearchContextType>(defaultContext);

export interface SearchProviderProps {
  children: ReactNode;
  initialQuery?: string;
}

export function SearchProvider({ children, initialQuery = "" }: SearchProviderProps) {
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);

  const clearSearch = () => setSearchQuery("");

  return (
    <SearchContext.Provider value={{ searchQuery, setSearchQuery, clearSearch }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch(): SearchContextType {
  return useContext(SearchContext);
}
