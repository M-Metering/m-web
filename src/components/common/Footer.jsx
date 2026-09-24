function Footer() {
  return (
    <footer className="mt-12 border-t border-white/10 dark:border-white/5 bg-white/30 dark:bg-black/20 backdrop-blur-sm print:hidden">
      <div className="max-w-7xl mx-auto px-4 py-5">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
          {/* Product branding is ME Metering. JEDC is one of the discos this
              system serves, not the product — naming it here dated from when
              JED was the only flow (there are now imported discos too), and
              `indigo` was the last remaining hardcoded colour from the
              pre-rebrand palette. Both now follow the brand tokens. */}
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            &copy; {new Date().getFullYear()} <span className="font-medium text-brand-700 dark:text-brand-400">ME Metering</span>. All rights reserved.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-600">
            ME Metering System
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;