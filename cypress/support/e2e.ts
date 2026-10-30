import './commands'

// Błędy JS strony nie przerywają audytów – zbiera je i raportuje spec 11-console
Cypress.on('uncaught:exception', () => false)
