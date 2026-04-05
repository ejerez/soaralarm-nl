import React, { useState, useEffect, useRef, useCallback } from 'react'
import { fs } from '../fs.js'

const T = {
  bg:        '#1a1a1a',
  card:      '#262626',
  border:    '#3d3d3d',
  borderDim: '#353535',
  text:      '#dedede',
  text2:     '#9a9a9a',
  text3:     '#757575',
  accent:    '#5578e8',
  font:      "'Atkinson Hyperlegible', system-ui, sans-serif",
}

const STORAGE_KEY = 'soar_terms_accepted'
const TERMS_VERSION = 1

export default function TermsAndConditions() {
  const [open, setOpen] = useState(false)
  const [scrolledToEnd, setScrolledToEnd] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    const accepted = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10)
    if (accepted < TERMS_VERSION) {
      setOpen(true)
    }
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) {
      setScrolledToEnd(true)
    }
  }, [])

  function accept() {
    if (!scrolledToEnd) return
    const isNewUser = !localStorage.getItem('soaralarm_welcomed')
    localStorage.setItem(STORAGE_KEY, String(TERMS_VERSION))
    setOpen(false)
    // New users get the tutorial after accepting T&C
    if (isNewUser) {
      window.dispatchEvent(new Event('soaralarm:start-tutorial'))
    }
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 10, padding: '24px 28px',
        maxWidth: 640, width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        fontFamily: T.font, color: T.text,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
      }}>
        <div ref={scrollRef} onScroll={handleScroll} style={{
          overflowY: 'auto', flex: 1, paddingRight: 8,
          lineHeight: 1.6, fontSize: fs(13),
        }}>
          <h1 style={{ fontSize: fs(22), fontWeight: 700, margin: '0 0 4px' }}>Terms and Conditions</h1>
          <p style={{ color: T.text3, fontSize: fs(12), marginTop: 0 }}>Last updated: April 05, 2026</p>
          <p>Please read these terms and conditions carefully before using Our Service.</p>

          {/* ── Important Notice ── */}
          <div style={{
            background: 'rgba(85,120,232,0.10)', border: `1px solid ${T.accent}44`,
            borderRadius: 8, padding: '14px 16px', margin: '16px 0',
          }}>
            <p style={{ fontWeight: 700, marginTop: 0 }}>Important Notice</p>
            <p style={{ margin: '8px 0' }}>
              Soaralarm is provided as a <strong>free service</strong> and all information
              presented is <strong>for informational and guidance purposes only, and should not be interpreted to be definitive or absolute</strong>. We do our best effort
              to provide accurate and up-to-date information, but the forecasts, flyability estimations
              and data provided do not constitute a guarantee that a pilot will be able to fly safely.
            </p>
            <p style={{ margin: '8px 0' }}>
              The <strong>decision to fly lies solely with the pilot</strong>. It is the
              pilot's responsibility to assess all conditions and risks before undertaking any
              flight. Soaralarm <strong>cannot be held liable</strong> for the accuracy,
              completeness, or reliability of the information it provides, nor for any
              consequences arising from the use of or reliance on such information.
            </p>
          </div>

          <h2 style={hStyle}>Interpretation and Definitions</h2>
          <h3 style={h3Style}>Interpretation</h3>
          <p>The words whose initial letters are capitalized have meanings defined under the following conditions. The following definitions shall have the same meaning regardless of whether they appear in singular or in plural.</p>
          <h3 style={h3Style}>Definitions</h3>
          <p>For the purposes of these Terms and Conditions:</p>
          <ul style={ulStyle}>
            <li><strong>Application</strong> means the software program provided by Soaralarm downloaded by You on any electronic device, named Soaralarm</li>
            <li><strong>Application Store</strong> means the digital distribution service operated and developed by Apple Inc. (Apple App Store) or Google Inc. (Google Play Store) in which the Application has been downloaded.</li>
            <li><strong>Country</strong> refers to: the Netherlands</li>
            <li><strong>Soaralarm</strong> (also referred to as "We", "Us" or "Our" in these Terms and Conditions) is an open-source project developed and maintained by independent developers based in Europe.</li>
            <li><strong>Device</strong> means any device that can access the Service such as a computer, a cell phone or a digital tablet.</li>
            <li><strong>Service</strong> refers to the Application or the Website or both.</li>
            <li><strong>Terms and Conditions</strong> (also referred to as "Terms") means these Terms and Conditions, including any documents expressly incorporated by reference, which govern Your access to and use of the Service and form the entire agreement between You and Soaralarm regarding the Service.</li>
            <li><strong>Third-Party Content</strong> means any services, data, information, or content provided by a third party that is displayed, included, made available, or linked to through the Service, including but not limited to primary data sources.</li>
            <li><strong>Website</strong> refers to Soaralarm, accessible from <a href="https://soaralarm.eu" rel="external nofollow noopener" target="_blank" style={linkStyle}>soaralarm.eu</a></li>
            <li><strong>You</strong> means the individual accessing or using the Service, or the company, or other legal entity on behalf of which such individual is accessing or using the Service, as applicable.</li>
          </ul>

          <h2 style={hStyle}>Acknowledgment</h2>
          <p>These are the Terms and Conditions governing the use of this Service and the agreement between You and Soaralarm. These Terms and Conditions set out the rights and obligations of all users regarding the use of the Service.</p>
          <p>Your access to and use of the Service is conditioned on Your acceptance of and compliance with these Terms and Conditions. These Terms and Conditions apply to all visitors, users and others who access or use the Service.</p>
          <p>By accessing or using the Service You agree to be bound by these Terms and Conditions. If You disagree with any part of these Terms and Conditions then You may not access the Service.</p>
          <p>You represent that you are over the age of 18. Soaralarm does not permit those under 18 to use the Service.</p>
          <p>The Service is currently only available to users located within the European Union. If You are located outside the European Union, You are not permitted to use the Service.</p>

          <h2 style={hStyle}>No Data Collection</h2>
          <p>The Service does not collect, store, or process any personal data from its users. No accounts, tracking mechanisms, or analytics are used to identify or monitor You.</p>
          <p>The Service uses cookies and local storage solely to save Your preferences and settings (such as display options and acceptance of these Terms). These are stored locally on Your Device and are never transmitted to any server or third party.</p>

          <h2 style={hStyle}>Links to Other Websites and Third-Party Content</h2>
          <p>Our Service contains links to third-party websites and services that are not owned or controlled by Soaralarm (such as Google Maps, Wildvliegen.nl, and others). These links are provided for Your convenience to access primary information sources. Soaralarm has no control over, and assumes no responsibility for, the content, accuracy, privacy policies, or practices of any such third-party websites or services.</p>
          <p>All forecasts, measurements, and flyability calculations presented within the Service are based on data fetched from third-party sources. Soaralarm is not liable if the information provided by these third-party sources is incorrect, incomplete, or outdated. You acknowledge and agree that Soaralarm shall not be responsible or liable, directly or indirectly, for any damage or loss caused or alleged to be caused by or in connection with the use of or reliance on any data, content, or services available on or through any such third-party websites or sources.</p>
          <p>We strongly advise You to read the terms and conditions and privacy policies of any third-party websites or services that You visit.</p>

          <h2 style={hStyle}>Termination</h2>
          <p>We may terminate or suspend Your access immediately, without prior notice or liability, for any reason whatsoever, including without limitation if You breach these Terms and Conditions. As the Service is provided free of charge, You have no entitlement to continued access.</p>
          <p>Upon termination, Your right to use the Service will cease immediately.</p>

          <h2 style={hStyle}>Limitation of Liability</h2>
          <p>The Service is provided entirely free of charge. Notwithstanding any damages that You might incur, the entire liability of Soaralarm and its developers under any provision of these Terms and Your exclusive remedy for all of the foregoing shall be limited to zero euros (EUR 0,-).</p>
          <p>To the maximum extent permitted by applicable law, in no event shall Soaralarm or its developers be liable for any special, incidental, indirect, or consequential damages whatsoever (including, but not limited to, damages for loss of profits, loss of data or other information, for business interruption, for personal injury, loss of privacy arising out of or in any way related to the use of or inability to use the Service, third-party software and/or third-party hardware used with the Service, or otherwise in connection with any provision of these Terms), even if Soaralarm or any developer has been advised of the possibility of such damages and even if the remedy fails of its essential purpose.</p>
          <p>Some jurisdictions do not allow the exclusion of implied warranties or limitation of liability for incidental or consequential damages, which means that some of the above limitations may not apply. In such cases, each party's liability will be limited to the greatest extent permitted by law.</p>

          <h2 style={hStyle}>"AS IS" and "AS AVAILABLE" Disclaimer</h2>
          <p>The Service is provided to You "AS IS" and "AS AVAILABLE" and with all faults and defects without warranty of any kind. To the maximum extent permitted under applicable law, Soaralarm and its developers expressly disclaim all warranties, whether express, implied, statutory or otherwise, with respect to the Service, including all implied warranties of merchantability, fitness for a particular purpose, title and non-infringement, and warranties that may arise out of course of dealing, course of performance, usage or trade practice. Without limitation to the foregoing, Soaralarm provides no warranty or undertaking, and makes no representation of any kind that the Service will meet Your requirements, achieve any intended results, be compatible or work with any other software, applications, systems or services, operate without interruption, meet any performance or reliability standards or be error free or that any errors or defects can or will be corrected.</p>
          <p>Without limiting the foregoing, neither Soaralarm nor any of its developers makes any representation or warranty of any kind, express or implied: (i) as to the operation or availability of the Service, or the information, content, and materials included thereon; (ii) that the Service will be uninterrupted or error-free; (iii) as to the accuracy, reliability, or currency of any information or content provided through the Service; or (iv) that the Service, its servers, or the content are free of viruses, scripts, trojan horses, worms, malware, timebombs or other harmful components.</p>
          <p>Some jurisdictions do not allow the exclusion of certain types of warranties or limitations on applicable statutory rights of a consumer, so some or all of the above exclusions and limitations may not apply to You. But in such a case the exclusions and limitations set forth in this section shall be applied to the greatest extent enforceable under applicable law.</p>

          <h2 style={hStyle}>Governing Law</h2>
          <p>The laws of the Country, excluding its conflicts of law rules, shall govern these Terms and Your use of the Service. Your use of the Application may also be subject to other local, state, national, or international laws.</p>

          <h2 style={hStyle}>Disputes Resolution</h2>
          <p>If You have any concern or dispute about the Service, You agree to first try to resolve the dispute informally by contacting Soaralarm.</p>

          <h2 style={hStyle}>For European Union (EU) Users</h2>
          <p>If You are a European Union consumer, you will benefit from any mandatory provisions of the law of the country in which You are resident.</p>

          <h2 style={hStyle}>Severability and Waiver</h2>
          <h3 style={h3Style}>Severability</h3>
          <p>If any provision of these Terms is held to be unenforceable or invalid, such provision will be changed and interpreted to accomplish the objectives of such provision to the greatest extent possible under applicable law and the remaining provisions will continue in full force and effect.</p>
          <h3 style={h3Style}>Waiver</h3>
          <p>Except as provided herein, the failure to exercise a right or to require performance of an obligation under these Terms shall not affect a party's ability to exercise such right or require such performance at any time thereafter nor shall the waiver of a breach constitute a waiver of any subsequent breach.</p>

          <h2 style={hStyle}>User Suggestions and Contributions</h2>
          <p>Any changes, suggestions, feature requests, feedback, or ideas that You submit or communicate to Soaralarm, whether through the Service, email, or any other channel, may be implemented into the Service at Our sole discretion, without any obligation to provide compensation (monetary or otherwise), credit, or attribution to You. By submitting such suggestions, You waive any and all claims to ownership or entitlement related to their use.</p>

          <h2 style={hStyle}>Translation Interpretation</h2>
          <p>These Terms and Conditions may have been translated if We have made them available to You on our Service. You agree that the original English text shall prevail in the case of a dispute.</p>

          <h2 style={hStyle}>Changes to These Terms and Conditions</h2>
          <p>We reserve the right, at Our sole discretion, to modify or replace these Terms at any time. When the Terms are updated, You will be required to review and accept the new Terms before You can continue to access or use the Service. The updated Terms will take effect immediately upon publication.</p>
          <p>If You do not agree to the new terms, You may not continue to use the Service.</p>

          <h2 style={hStyle}>Contact Us</h2>
          <p>If you have any questions about these Terms and Conditions, You can contact us:</p>
          <ul style={ulStyle}>
            <li>By email: <a href="mailto:info@soaralarm.eu" style={linkStyle}>info@soaralarm.eu</a></li>
          </ul>
        </div>

        {!scrolledToEnd && (
          <p style={{ fontSize: fs(11), color: T.text3, textAlign: 'center', margin: '8px 0 0', flexShrink: 0 }}>
            Please scroll to the bottom to enable the Accept button
          </p>
        )}
        <button onClick={accept} disabled={!scrolledToEnd} style={{
          marginTop: 8, width: '100%',
          background: scrolledToEnd ? T.accent : T.border,
          color: scrolledToEnd ? '#fff' : T.text3,
          border: 'none',
          borderRadius: 6, padding: '12px 0',
          fontSize: fs(14), fontWeight: 600,
          cursor: scrolledToEnd ? 'pointer' : 'not-allowed',
          fontFamily: T.font, flexShrink: 0,
          transition: 'background 0.2s, color 0.2s',
        }}>
          Accept
        </button>
      </div>
    </div>
  )
}

const hStyle = { fontSize: fs(16), fontWeight: 700, marginTop: 24, marginBottom: 8 }
const h3Style = { fontSize: fs(14), fontWeight: 600, marginTop: 16, marginBottom: 6 }
const ulStyle = { paddingLeft: 20 }
const linkStyle = { color: T.accent, textDecoration: 'none' }
